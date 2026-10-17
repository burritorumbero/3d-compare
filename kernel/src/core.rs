//! Parametric deformation and measurement solver for rigged meshes.
//!
//! A rig is a hierarchy of deform bones whose rest rotation is the identity, so
//! every bone transform is an axis-aligned scale about the bone head, composed
//! down the chain. Bone heads sit on the floor plane (y = 0), so scaling never
//! lifts a sole off the floor. The same transforms drive the GPU through
//! three.js bone scales; this module evaluates them on the CPU for the few
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
}

#[derive(Clone, Debug)]
pub struct Rig {
    pub parents: Vec<i32>,
    pub heads: Vec<[f64; 3]>,
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

/// Bone scales and morph weights for a set of controls: what the GPU needs.
#[derive(Clone, Debug, PartialEq)]
pub struct Pose {
    pub bone_scales: Vec<[f64; 3]>,
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
        if self.heads.len() != bones {
            return invalid("Every bone needs a head position.");
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
        let mut bone_scales = vec![[1.0; 3]; self.parents.len()];
        let mut morph_weights = vec![0.0; self.morphs.len()];
        for channel in &self.channels {
            match *channel {
                Channel::BoneScale { control, bone, axis, gain } => {
                    bone_scales[bone][axis] *= 1.0 + gain * (controls[control] - 1.0);
                }
                Channel::Morph { control, morph, gain } => {
                    morph_weights[morph] += gain * (controls[control] - 1.0);
                }
            }
        }
        for weight in &mut morph_weights {
            *weight = weight.clamp(0.0, 1.0);
        }
        Pose { bone_scales, morph_weights }
    }

    /// Skinning transforms as v -> scale * v + offset, composed parent first.
    fn skin_transforms(&self, pose: &Pose) -> Vec<([f64; 3], [f64; 3])> {
        let mut transforms: Vec<([f64; 3], [f64; 3])> = Vec::with_capacity(self.parents.len());
        for (bone, &parent) in self.parents.iter().enumerate() {
            let (parent_scale, parent_offset) = if parent < 0 {
                ([1.0; 3], [0.0; 3])
            } else {
                transforms[parent as usize]
            };
            let local = pose.bone_scales[bone];
            let head = self.heads[bone];
            let mut scale = [0.0; 3];
            let mut offset = [0.0; 3];
            for axis in 0..3 {
                scale[axis] = parent_scale[axis] * local[axis];
                offset[axis] = parent_scale[axis] * (head[axis] - local[axis] * head[axis]) + parent_offset[axis];
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
                    for axis in 0..3 {
                        deformed[axis] += weight * (scale[axis] * morphed[axis] + offset[axis]);
                    }
                }
                deformed
            })
            .collect()
    }

    pub fn evaluate(&self, controls: &[f64]) -> Evaluation {
        let points = self.deform(controls);
        let measures = self.measure(&points);
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
                Measure::Between { from, to, .. } => {
                    mark(from);
                    mark(to);
                }
            }
        }
        mask
    }

    fn measure(&self, points: &[[f64; 3]]) -> Vec<f64> {
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
        let measures = self.measure(&self.deform_only(controls, Some(mask)));
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
