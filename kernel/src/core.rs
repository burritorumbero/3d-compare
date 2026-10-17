//! Parametric deformation and measurement solver for rigged meshes.
//!
//! A rig is a hierarchy of deform bones with optional anatomical scale bases.
//! Every bone scales about its head in that basis. A bone either inherits its
//! parent's deformation (a foot's toes grow with the foot) or keeps only its own while still moving with its parent (a
//! longer shin lifts the thigh without stretching it). Feet rigs put bone heads on
//! the floor; body rigs chain upward from a root on the floor, so soles stay down.
//! The same transforms drive the GPU through three.js local affine matrices; this module evaluates them on the CPU for the few
//! vertices that measurements and bounds need, and solves the inverse problem:
//! which control values make the mesh measure what the user asked for.
//!
//! Units are the rig's (meters for the shipped GLBs). Controls are factors
//! with a rest value of 1.

/// One way a control moves the rig.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Channel {
    /// Multiplies `bone`'s scale on `axis` by `1 + gain * (u - 1)`.
    BoneScale { control: usize, bone: usize, axis: usize, gain: f64 },
    /// Adds `gain * (u - 1)` to `morph`'s weight, clamped to [0, 1] after all channels.
    Morph { control: usize, morph: usize, gain: f64 },
}

/// A quantity read off the deformed vertices.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Measure {
    /// Max minus min of a vertex group along an axis: a length, width, or height span.
    Extent { group: usize, axis: usize },
    /// Highest coordinate of a vertex group along an axis: a height above the floor.
    Max { group: usize, axis: usize },
    /// Distance along an axis between the centroids of two groups.
    Between { from: usize, to: usize, axis: usize },
    /// Euclidean distance between the centroids of two surface groups.
    Distance { from: usize, to: usize },
    /// Sum of posed joint-to-joint lengths along an ancestor/descendant chain.
    BonePath { from: usize, to: usize },
}

/// Column-major 3x3 matrix, matching three.js / GLSL storage.
pub type Mat3 = [f64; 9];
pub const IDENTITY: Mat3 = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

#[inline(never)]
fn apply(m: Mat3, v: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|row| (0..3).map(|k| m[k * 3 + row] * v[k]).sum())
}

#[inline(never)]
fn multiply(a: Mat3, b: Mat3) -> Mat3 {
    std::array::from_fn(|i| (0..3).map(|k| a[k * 3 + i % 3] * b[i / 3 * 3 + k]).sum())
}

fn transpose(m: Mat3) -> Mat3 {
    std::array::from_fn(|i| m[i % 3 * 3 + i / 3])
}

fn inverse(m: Mat3) -> Mat3 {
    let cofactor = [
        m[4] * m[8] - m[5] * m[7], m[5] * m[6] - m[3] * m[8], m[3] * m[7] - m[4] * m[6],
        m[7] * m[2] - m[8] * m[1], m[8] * m[0] - m[6] * m[2], m[6] * m[1] - m[7] * m[0],
        m[1] * m[5] - m[2] * m[4], m[2] * m[3] - m[0] * m[5], m[0] * m[4] - m[1] * m[3],
    ];
    let determinant = m[0] * cofactor[0] + m[1] * cofactor[1] + m[2] * cofactor[2];
    transpose(cofactor).map(|v| v / determinant)
}

fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|axis| (a[axis] - b[axis]).powi(2)).sum::<f64>().sqrt()
}

#[derive(Clone, Debug)]
pub struct Rig {
    pub parents: Vec<i32>,
    pub heads: Vec<[f64; 3]>,
    /// Orthonormal columns in rest mesh space; identity for axis-aligned bones.
    pub bases: Vec<Mat3>,
    /// Per bone: whether its world scale includes its parent's scale.
    pub inherit_scale: Vec<bool>,
    pub positions: Vec<[f64; 3]>,
    /// Four bone influences per vertex.
    pub skin_bones: Vec<[usize; 4]>,
    pub skin_weights: Vec<[f64; 4]>,
    /// Per morph, one delta per vertex.
    pub morphs: Vec<Vec<[f64; 3]>>,
    pub channels: Vec<Channel>,
    pub control_bounds: Vec<[f64; 2]>,
    pub groups: Vec<Vec<usize>>,
    pub measures: Vec<Measure>,
    /// The group whose vertices bound the deformed mesh (an extreme-point sample).
    pub hull_group: usize,
}

#[derive(Debug, PartialEq)]
pub enum RigError {
    Invalid(String),
}

impl std::fmt::Display for RigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RigError::Invalid(message) => f.write_str(message),
        }
    }
}

fn invalid<T>(message: impl Into<String>) -> Result<T, RigError> {
    Err(RigError::Invalid(message.into()))
}

/// Affine bone transforms and morph weights for a set of controls.
#[derive(Clone, Debug, PartialEq)]
pub struct Pose {
    /// Full local matrix per bone, including its rest parent-to-child translation.
    pub bone_matrices: Vec<[f64; 16]>,
    pub world_linear: Vec<Mat3>,
    pub morph_weights: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Evaluation {
    pub measures: Vec<f64>,
    /// Min x, y, z then max x, y, z of the hull group.
    pub bounds: [f64; 6],
}

#[derive(Clone, Debug, PartialEq)]
pub struct Solution {
    pub controls: Vec<f64>,
    pub evaluation: Evaluation,
    pub iterations: u32,
    /// Largest |measured - target| over the targeted measures, in rig units.
    pub max_error: f64,
}

/// What to solve for. `targets[i]` is `None` for measures left free.
pub struct Problem<'a> {
    pub targets: &'a [Option<f64>],
    pub initial: &'a [f64],
    /// Values the controls are pulled toward when the targets leave freedom.
    pub prior: &'a [f64],
    /// Weight of the prior relative to a 1 mm measurement error.
    pub prior_weight: f64,
    /// Stop once every target is met within this, in rig units.
    pub tolerance: f64,
}

impl Rig {
    pub fn validate(&self) -> Result<(), RigError> {
        let bones = self.parents.len();
        if self.heads.len() != bones || self.inherit_scale.len() != bones || self.bases.len() != bones {
            return invalid("Every bone needs a head position, scale basis and inherit flag.");
        }
        for basis in &self.bases {
            let gram = multiply(transpose(*basis), *basis);
            if basis.iter().any(|v| !v.is_finite()) || gram.iter().zip(IDENTITY).any(|(a,b)| (a-b).abs() > 1e-5) {
                return invalid("Bone scale bases must be finite and orthonormal.");
            }
        }
        for (index, &parent) in self.parents.iter().enumerate() {
            if parent >= index as i32 || parent < -1 {
                return invalid(format!("Bone {index} must come after its parent."));
            }
        }
        let vertices = self.positions.len();
        if self.skin_bones.len() != vertices || self.skin_weights.len() != vertices {
            return invalid("Every vertex needs four skin influences.");
        }
        for (influences, weights) in self.skin_bones.iter().zip(&self.skin_weights) {
            if influences.iter().any(|&bone| bone >= bones) {
                return invalid("A skin influence names a missing bone.");
            }
            let total: f64 = weights.iter().sum();
            if (total - 1.0).abs() > 1e-3 {
                return invalid("Skin weights must sum to 1 for every vertex.");
            }
        }
        if self.morphs.iter().any(|deltas| deltas.len() != vertices) {
            return invalid("Every morph needs one delta per vertex.");
        }
        let controls = self.control_bounds.len();
        for channel in &self.channels {
            let ok = match *channel {
                Channel::BoneScale { control, bone, axis, .. } => control < controls && bone < bones && axis < 3,
                Channel::Morph { control, morph, .. } => control < controls && morph < self.morphs.len(),
            };
            if !ok {
                return invalid("A channel names a missing control, bone, morph, or axis.");
            }
        }
        if self.control_bounds.iter().any(|[low, high]| !(low <= &1.0 && &1.0 <= high)) {
            return invalid("Control bounds must contain the rest value 1.");
        }
        if self.groups.iter().any(|group| group.is_empty() || group.iter().any(|&vertex| vertex >= vertices)) {
            return invalid("Vertex groups must be non-empty and name existing vertices.");
        }
        let groups = self.groups.len();
        for measure in &self.measures {
            let ok = match *measure {
                Measure::Extent { group, axis } | Measure::Max { group, axis } => group < groups && axis < 3,
                Measure::Between { from, to, axis } => from < groups && to < groups && axis < 3,
                Measure::Distance { from, to } => from < groups && to < groups,
                Measure::BonePath { from, to } => {
                    let mut cursor = to as i32;
                    if from >= bones || to >= bones || from == to { false } else {
                        while cursor >= 0 && cursor as usize != from { cursor = self.parents[cursor as usize]; }
                        cursor == from as i32
                    }
                }
            };
            if !ok {
                return invalid("A measure names a missing group or axis.");
            }
        }
        if self.hull_group >= groups {
            return invalid("The hull group does not exist.");
        }
        Ok(())
    }

    pub fn control_count(&self) -> usize {
        self.control_bounds.len()
    }

    pub fn pose(&self, controls: &[f64]) -> Pose {
        let mut own = vec![[1.0; 3]; self.parents.len()];
        let mut morph_weights = vec![0.0; self.morphs.len()];
        for channel in &self.channels {
            match *channel {
                Channel::BoneScale { control, bone, axis, gain } => {
                    own[bone][axis] *= 1.0 + gain * (controls[control] - 1.0);
                }
                Channel::Morph { control, morph, gain } => {
                    morph_weights[morph] += gain * (controls[control] - 1.0);
                }
            }
        }
        for weight in &mut morph_weights {
            *weight = weight.clamp(0.0, 1.0);
        }
        let mut world_linear: Vec<Mat3> = Vec::with_capacity(own.len());
        let mut bone_matrices = Vec::with_capacity(own.len());
        for (bone, &parent) in self.parents.iter().enumerate() {
            let parent_world = if parent < 0 { IDENTITY } else { world_linear[parent as usize] };
            let basis = self.bases[bone];
            let scaled_basis = std::array::from_fn(|i| basis[i] * own[bone][i / 3]);
            let own_linear = multiply(scaled_basis, transpose(basis));
            let world = if self.inherit_scale[bone] {
                multiply(parent_world, own_linear)
            } else {
                own_linear
            };
            // Oriented anisotropy needs matrix compensation: component-wise division
            // would introduce shear/scale errors when the parent has a different basis.
            let local = multiply(inverse(parent_world), world);
            let parent_head = if parent < 0 { [0.0; 3] } else { self.heads[parent as usize] };
            let translation: [f64; 3] = std::array::from_fn(|axis| self.heads[bone][axis] - parent_head[axis]);
            bone_matrices.push([
                local[0], local[1], local[2], 0.0,
                local[3], local[4], local[5], 0.0,
                local[6], local[7], local[8], 0.0,
                translation[0], translation[1], translation[2], 1.0,
            ]);
            world_linear.push(world);
        }
        Pose { bone_matrices, world_linear, morph_weights }
    }

    /// Skinning transforms as v -> linear * v + offset, composed parent first.
    fn skin_transforms(&self, pose: &Pose) -> Vec<(Mat3, [f64; 3])> {
        let mut transforms: Vec<(Mat3, [f64; 3])> = Vec::with_capacity(self.parents.len());
        for (bone, &parent) in self.parents.iter().enumerate() {
            let (parent_scale, parent_offset) = if parent < 0 {
                (IDENTITY, [0.0; 3])
            } else {
                transforms[parent as usize]
            };
            // The head rides on the parent's transform; the bone scales about it.
            let scale = pose.world_linear[bone];
            let head = self.heads[bone];
            let parent_point = apply(parent_scale, head);
            let own_point = apply(scale, head);
            let mut offset = [0.0; 3];
            for axis in 0..3 {
                offset[axis] = parent_point[axis] + parent_offset[axis] - own_point[axis];
            }
            transforms.push((scale, offset));
        }
        transforms
    }

    pub fn deform(&self, controls: &[f64]) -> Vec<[f64; 3]> {
        self.deform_only(controls, None)
    }

    /// Deforms every vertex, or only those `needed` marks (the rest stay at rest).
    fn deform_only(&self, controls: &[f64], needed: Option<&[bool]>) -> Vec<[f64; 3]> {
        let pose = self.pose(controls);
        let transforms = self.skin_transforms(&pose);
        self.positions
            .iter()
            .enumerate()
            .map(|(vertex, rest)| {
                if needed.is_some_and(|mask| !mask[vertex]) {
                    return *rest;
                }
                let mut morphed = *rest;
                for (deltas, &weight) in self.morphs.iter().zip(&pose.morph_weights) {
                    if weight != 0.0 {
                        for axis in 0..3 {
                            morphed[axis] += weight * deltas[vertex][axis];
                        }
                    }
                }
                let mut deformed = [0.0; 3];
                for slot in 0..4 {
                    let weight = self.skin_weights[vertex][slot];
                    if weight == 0.0 {
                        continue;
                    }
                    let (scale, offset) = transforms[self.skin_bones[vertex][slot]];
                    let point = apply(scale, morphed);
                    for axis in 0..3 {
                        deformed[axis] += weight * (point[axis] + offset[axis]);
                    }
                }
                deformed
            })
            .collect()
    }

    pub fn evaluate(&self, controls: &[f64]) -> Evaluation {
        let points = self.deform(controls);
        let measures = self.measure(&points, controls);
        let mut bounds = [f64::INFINITY, f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        for &vertex in &self.groups[self.hull_group] {
            for axis in 0..3 {
                bounds[axis] = bounds[axis].min(points[vertex][axis]);
                bounds[axis + 3] = bounds[axis + 3].max(points[vertex][axis]);
            }
        }
        Evaluation { measures, bounds }
    }

    /// Marks the vertices any measure reads, so solver iterations skip the hull.
    fn measured_vertices(&self) -> Vec<bool> {
        let mut mask = vec![false; self.positions.len()];
        let mut mark = |group: usize| self.groups[group].iter().for_each(|&vertex| mask[vertex] = true);
        for measure in &self.measures {
            match *measure {
                Measure::Extent { group, .. } | Measure::Max { group, .. } => mark(group),
                Measure::Between { from, to, .. } | Measure::Distance { from, to } => {
                    mark(from);
                    mark(to);
                }
                Measure::BonePath { .. } => {},
            }
        }
        mask
    }

    fn measure(&self, points: &[[f64; 3]], controls: &[f64]) -> Vec<f64> {
        let transforms = self.skin_transforms(&self.pose(controls));
        let joint = |bone: usize| {
            let (linear, offset) = transforms[bone];
            let point = apply(linear, self.heads[bone]);
            std::array::from_fn(|axis| point[axis] + offset[axis])
        };
        let span = |group: usize, axis: usize| {
            self.groups[group].iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(low, high), &vertex| {
                (low.min(points[vertex][axis]), high.max(points[vertex][axis]))
            })
        };
        let centroid = |group: usize, axis: usize| {
            let members = &self.groups[group];
            members.iter().map(|&vertex| points[vertex][axis]).sum::<f64>() / members.len() as f64
        };
        self.measures
            .iter()
            .map(|measure| match *measure {
                Measure::Extent { group, axis } => {
                    let (low, high) = span(group, axis);
                    high - low
                }
                Measure::Max { group, axis } => span(group, axis).1,
                Measure::Between { from, to, axis } => (centroid(to, axis) - centroid(from, axis)).abs(),
                Measure::Distance { from, to } => distance(
                    std::array::from_fn(|axis| centroid(from, axis)),
                    std::array::from_fn(|axis| centroid(to, axis)),
                ),
                Measure::BonePath { from, to } => {
                    let mut length = 0.0;
                    let mut cursor = to;
                    while cursor != from {
                        let parent = self.parents[cursor] as usize;
                        length += distance(joint(cursor), joint(parent));
                        cursor = parent;
                    }
                    length
                },
            })
            .collect()
    }

    fn clamp_controls(&self, controls: &mut [f64]) {
        for (value, [low, high]) in controls.iter_mut().zip(&self.control_bounds) {
            *value = value.clamp(*low, *high);
        }
    }

    /// Residuals in millimeter-scaled units: targeted measures first, then the prior.
    fn residuals(&self, problem: &Problem, controls: &[f64], mask: &[bool]) -> (Vec<f64>, Vec<f64>) {
        let measures = self.measure(&self.deform_only(controls, Some(mask)), controls);
        let mut residuals = Vec::with_capacity(problem.targets.len() + controls.len());
        for (measured, target) in measures.iter().zip(problem.targets) {
            if let Some(target) = target {
                residuals.push((measured - target) * MM_PER_UNIT);
            }
        }
        let prior = problem.prior_weight.sqrt();
        for (value, wanted) in controls.iter().zip(problem.prior) {
            residuals.push(prior * (value - wanted));
        }
        (residuals, measures)
    }

    fn max_error(measures: &[f64], targets: &[Option<f64>]) -> f64 {
        measures
            .iter()
            .zip(targets)
            .filter_map(|(measured, target)| target.map(|target| (measured - target).abs()))
            .fold(0.0, f64::max)
    }

    /// Levenberg-Marquardt over the controls with a central-difference Jacobian.
    pub fn solve(&self, problem: &Problem) -> Result<Solution, RigError> {
        let count = self.control_count();
        if problem.targets.len() != self.measures.len() || problem.initial.len() != count || problem.prior.len() != count {
            return invalid("Targets, initial controls, and prior must match the rig.");
        }
        if problem.targets.iter().flatten().any(|target| !target.is_finite()) {
            return invalid("Targets must be finite.");
        }

        let mask = self.measured_vertices();
        let mut controls = problem.initial.to_vec();
        self.clamp_controls(&mut controls);
        let (mut residuals, mut measures) = self.residuals(problem, &controls, &mask);
        let mut cost: f64 = residuals.iter().map(|value| value * value).sum();
        let mut damping = 1e-3;
        let mut iterations = 0;

        while iterations < MAX_ITERATIONS && Self::max_error(&measures, problem.targets) > problem.tolerance {
            iterations += 1;
            let jacobian = self.jacobian(problem, &controls, residuals.len(), &mask);
            let mut normal = vec![vec![0.0; count]; count];
            let mut gradient = vec![0.0; count];
            for row in 0..residuals.len() {
                for i in 0..count {
                    gradient[i] += jacobian[row][i] * residuals[row];
                    for j in 0..count {
                        normal[i][j] += jacobian[row][i] * jacobian[row][j];
                    }
                }
            }

            let mut improved = false;
            for _ in 0..12 {
                let mut system = normal.clone();
                for i in 0..count {
                    system[i][i] += damping * (normal[i][i] + 1e-9);
                }
                let Some(step) = solve_linear(system, gradient.iter().map(|value| -value).collect()) else {
                    damping *= 10.0;
                    continue;
                };
                let mut candidate: Vec<f64> = controls.iter().zip(&step).map(|(value, delta)| value + delta).collect();
                self.clamp_controls(&mut candidate);
                let (next_residuals, next_measures) = self.residuals(problem, &candidate, &mask);
                let next_cost: f64 = next_residuals.iter().map(|value| value * value).sum();
                if next_cost < cost {
                    controls = candidate;
                    residuals = next_residuals;
                    measures = next_measures;
                    cost = next_cost;
                    damping = (damping * 0.3).max(1e-12);
                    improved = true;
                    break;
                }
                damping *= 10.0;
            }
            if !improved {
                break;
            }
        }

        let max_error = Self::max_error(&measures, problem.targets);
        let evaluation = self.evaluate(&controls);
        Ok(Solution { controls, evaluation, iterations, max_error })
    }

    fn jacobian(&self, problem: &Problem, controls: &[f64], rows: usize, mask: &[bool]) -> Vec<Vec<f64>> {
        let count = controls.len();
        let mut jacobian = vec![vec![0.0; count]; rows];
        for column in 0..count {
            let mut ahead = controls.to_vec();
            let mut behind = controls.to_vec();
            ahead[column] += STEP;
            behind[column] -= STEP;
            let (forward, _) = self.residuals(problem, &ahead, mask);
            let (backward, _) = self.residuals(problem, &behind, mask);
            for row in 0..rows {
                jacobian[row][column] = (forward[row] - backward[row]) / (2.0 * STEP);
            }
        }
        jacobian
    }
}

/// Residuals are expressed in millimeters so the prior weight reads naturally.
const MM_PER_UNIT: f64 = 1000.0;
const MAX_ITERATIONS: u32 = 60;
const STEP: f64 = 1e-6;

/// Gaussian elimination with partial pivoting. `None` when the system is singular.
fn solve_linear(mut matrix: Vec<Vec<f64>>, mut rhs: Vec<f64>) -> Option<Vec<f64>> {
    let size = rhs.len();
    for column in 0..size {
        let pivot = (column..size).max_by(|&a, &b| matrix[a][column].abs().total_cmp(&matrix[b][column].abs()))?;
        if matrix[pivot][column].abs() < 1e-14 {
            return None;
        }
        matrix.swap(column, pivot);
        rhs.swap(column, pivot);
        for row in column + 1..size {
            let factor = matrix[row][column] / matrix[column][column];
            for k in column..size {
                matrix[row][k] -= factor * matrix[column][k];
            }
            rhs[row] -= factor * rhs[column];
        }
    }
    let mut solution = vec![0.0; size];
    for row in (0..size).rev() {
        let tail: f64 = (row + 1..size).map(|k| matrix[row][k] * solution[k]).sum();
        solution[row] = (rhs[row] - tail) / matrix[row][row];
    }
    Some(solution)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 2-bone bar along z: a heel bone at z = 0 and a toe bone at z = 0.7,
    /// with a hinge vertex blended between them. Controls: 0 scales the whole bar
    /// on z, 1 scales the toe part on z, 2 widens on x through a morph.
    fn bar() -> Rig {
        let positions = vec![[0.0, 0.0, 0.0], [0.1, 0.0, 0.7], [-0.1, 0.0, 0.7], [0.0, 0.2, 0.5], [0.0, 0.0, 1.0]];
        let skin_bones = vec![[0, 0, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0], [1, 0, 0, 0]];
        let skin_weights = vec![[1.0, 0.0, 0.0, 0.0], [0.5, 0.5, 0.0, 0.0], [0.5, 0.5, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]];
        let widen = vec![[0.0; 3], [0.05, 0.0, 0.0], [-0.05, 0.0, 0.0], [0.0; 3], [0.0; 3]];
        Rig {
            parents: vec![-1, 0],
            heads: vec![[0.0, 0.0, 0.0], [0.0, 0.0, 0.7]],
            bases: vec![IDENTITY; 2],
            inherit_scale: vec![true, true],
            positions,
            skin_bones,
            skin_weights,
            morphs: vec![widen],
            channels: vec![
                Channel::BoneScale { control: 0, bone: 0, axis: 2, gain: 1.0 },
                Channel::BoneScale { control: 1, bone: 1, axis: 2, gain: 1.0 },
                Channel::Morph { control: 2, morph: 0, gain: 2.0 },
            ],
            control_bounds: vec![[0.5, 2.0], [0.5, 2.0], [1.0, 1.5]],
            groups: vec![vec![0, 1, 2, 3, 4], vec![1, 2], vec![4], vec![3]],
            measures: vec![
                Measure::Extent { group: 0, axis: 2 },
                Measure::Between { from: 1, to: 2, axis: 2 },
                Measure::Extent { group: 1, axis: 0 },
                Measure::Max { group: 3, axis: 1 },
            ],
            hull_group: 0,
        }
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn rest_controls_leave_the_mesh_alone() {
        let rig = bar();
        rig.validate().unwrap();
        assert_eq!(rig.deform(&[1.0, 1.0, 1.0]), rig.positions);
        let evaluation = rig.evaluate(&[1.0, 1.0, 1.0]);
        assert!(close(evaluation.measures[0], 1.0));
        assert!(close(evaluation.measures[1], 0.3));
        assert!(close(evaluation.measures[2], 0.2));
        assert_eq!(evaluation.bounds, [-0.1, 0.0, 0.0, 0.1, 0.2, 1.0]);
    }

    #[test]
    fn child_bones_follow_their_parent_scale() {
        let rig = bar();
        // Doubling the root on z moves the toe bone's head to z = 1.4 and the tip to 2.0.
        let points = rig.deform(&[2.0, 1.0, 1.0]);
        assert!(close(points[4][2], 2.0));
        // Then doubling the toe bone stretches only past its head.
        let points = rig.deform(&[1.0, 2.0, 1.0]);
        assert!(close(points[4][2], 1.3));
        assert!(close(points[0][2], 0.0));
    }

    /// A column: shin (root, head on the floor) and thigh (head at the knee, 0.5),
    /// each owning one vertex at its top. Neither inherits the other's scale.
    fn column() -> Rig {
        Rig {
            parents: vec![-1, 0],
            heads: vec![[0.0, 0.0, 0.0], [0.0, 0.5, 0.0]],
            bases: vec![IDENTITY; 2],
            inherit_scale: vec![true, false],
            positions: vec![[0.0, 0.5, 0.0], [0.0, 0.9, 0.0], [0.1, 0.9, 0.0]],
            skin_bones: vec![[0, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]],
            skin_weights: vec![[1.0, 0.0, 0.0, 0.0]; 3],
            morphs: vec![],
            channels: vec![
                Channel::BoneScale { control: 0, bone: 0, axis: 1, gain: 1.0 },
                Channel::BoneScale { control: 0, bone: 0, axis: 0, gain: 1.0 },
                Channel::BoneScale { control: 1, bone: 1, axis: 1, gain: 1.0 },
            ],
            control_bounds: vec![[0.5, 2.0], [0.5, 2.0]],
            groups: vec![vec![1], vec![1, 2]],
            measures: vec![Measure::Max { group: 0, axis: 1 }, Measure::Extent { group: 1, axis: 0 }],
            hull_group: 1,
        }
    }

    #[test]
    fn non_inheriting_bones_move_without_stretching() {
        let rig = column();
        rig.validate().unwrap();
        // Doubling the shin lifts the knee to 1.0; the thigh keeps its 0.4 length and width.
        let points = rig.deform(&[2.0, 1.0]);
        assert!(close(points[0][1], 1.0));
        assert!(close(points[1][1], 1.4));
        assert!(close(points[2][0] - points[1][0], 0.1), "the thigh does not inherit the shin's width");
        // three.js needs the thigh's local scale to divide out the shin's.
        let pose = rig.pose(&[2.0, 1.5]);
        assert_eq!(pose.world_linear[1], [1.0, 0.0, 0.0, 0.0, 1.5, 0.0, 0.0, 0.0, 1.0]);
        assert_eq!(pose.bone_matrices[1], [0.5, 0.0, 0.0, 0.0, 0.0, 0.75, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.5, 0.0, 1.0]);
    }

    #[test]
    fn angled_limb_grows_along_its_axis_without_widening_or_inheriting_scale() {
        let mut rig = column();
        let c = 0.5_f64.sqrt();
        // Its local y axis is diagonal in XY. Local x is its cross-section.
        rig.bases[1] = [c, -c, 0.0, c, c, 0.0, 0.0, 0.0, 1.0];
        rig.positions[1] = [0.4*c, 0.5+0.4*c, 0.0];
        rig.positions[2] = [0.5*c, 0.5+0.3*c, 0.0];
        rig.validate().unwrap();
        let points = rig.deform(&[2.0, 1.5]);
        assert!(close(points[1][0], 0.6*c));
        assert!(close(points[1][1], 1.0+0.6*c));
        assert!(close(distance(points[1], points[2]), 0.1));
        let pose = rig.pose(&[2.0, 1.5]);
        let local = pose.bone_matrices[1];
        let linear = [local[0],local[1],local[2],local[4],local[5],local[6],local[8],local[9],local[10]];
        let composed = multiply(pose.world_linear[0], linear);
        for (a,b) in composed.iter().zip(pose.world_linear[1]) { assert!(close(*a,b)); }
        rig.bases[1][0] = 4.0;
        assert!(rig.validate().is_err());
    }

    #[test]
    fn joint_paths_and_surface_distances_measure_different_dimensions() {
        let mut rig = column();
        rig.measures = vec![Measure::BonePath { from: 0, to: 1 }, Measure::Distance { from: 0, to: 1 }];
        rig.validate().unwrap();
        let measured = rig.evaluate(&[2.0, 1.5]).measures;
        assert!(close(measured[0], 1.0), "parent extension moves the joint");
        assert!(close(measured[1], 0.05), "centroid distance uses all coordinates");
        rig.measures[0] = Measure::BonePath { from: 1, to: 0 };
        assert!(rig.validate().is_err(), "paths must follow the parent chain");
    }

    #[test]
    fn morph_weights_clamp() {
        let rig = bar();
        assert_eq!(rig.pose(&[1.0, 1.0, 1.25]).morph_weights, vec![0.5]);
        assert_eq!(rig.pose(&[1.0, 1.0, 2.0]).morph_weights, vec![1.0]);
        assert_eq!(rig.pose(&[1.0, 1.0, 0.5]).morph_weights, vec![0.0]);
    }

    #[test]
    fn solves_independent_targets_to_tolerance() {
        let rig = bar();
        let targets = [Some(1.2), Some(0.35), Some(0.25), None];
        let solution = rig
            .solve(&Problem { targets: &targets, initial: &[1.0; 3], prior: &[1.0; 3], prior_weight: 1e-6, tolerance: 1e-7 })
            .unwrap();
        assert!(solution.max_error < 1e-7, "error {}", solution.max_error);
        assert!(solution.iterations < 20);
    }

    #[test]
    fn unreachable_targets_stop_at_the_bounds() {
        let rig = bar();
        let targets = [None, None, Some(1.0), None];
        let solution = rig
            .solve(&Problem { targets: &targets, initial: &[1.0; 3], prior: &[1.0; 3], prior_weight: 0.0, tolerance: 1e-7 })
            .unwrap();
        assert!(close(solution.controls[2], 1.5));
        assert!(solution.max_error > 0.5);
    }

    #[test]
    fn rejects_inconsistent_rigs() {
        let mut rig = bar();
        rig.skin_weights[0] = [0.5, 0.0, 0.0, 0.0];
        assert!(rig.validate().is_err());
        let mut rig = bar();
        rig.parents = vec![1, -1];
        assert!(rig.validate().is_err());
        let mut rig = bar();
        rig.control_bounds[0] = [1.1, 2.0];
        assert!(rig.validate().is_err());
    }
}
