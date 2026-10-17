//! WebAssembly surface of the parametric kernel. Arguments are flat typed arrays
//! so the module needs no JSON parser; `src/kernel/rig.ts` encodes a rig file
//! into this layout and documents it.

mod core;

pub use crate::core::{Channel, Evaluation, Measure, Problem, Rig, RigError, Solution};
use wasm_bindgen::prelude::*;

fn triples(values: &[f64], what: &str) -> Result<Vec<[f64; 3]>, RigError> {
    if values.len() % 3 != 0 {
        return Err(RigError::Invalid(format!("{what} must hold x, y, z triples.")));
    }
    Ok(values.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect())
}

fn index(value: f64, what: &str) -> Result<usize, RigError> {
    if value.is_finite() && value >= 0.0 && value.fract() == 0.0 {
        Ok(value as usize)
    } else {
        Err(RigError::Invalid(format!("{what} must be a non-negative integer.")))
    }
}

/// Builds a rig from the flat layout. Separate from the wasm constructor so
/// native tests can exercise the decoding.
#[allow(clippy::too_many_arguments)]
pub fn decode_rig(
    parents: &[i32],
    heads: &[f64],
    inherit_scale: &[u8],
    positions: &[f64],
    skin_bones: &[u32],
    skin_weights: &[f64],
    morph_count: usize,
    morph_deltas: &[f64],
    channels: &[f64],
    control_bounds: &[f64],
    group_offsets: &[u32],
    group_members: &[u32],
    measures: &[u32],
    hull_group: u32,
) -> Result<Rig, RigError> {
    let positions = triples(positions, "Positions")?;
    let vertices = positions.len();
    if skin_bones.len() != vertices * 4 || skin_weights.len() != vertices * 4 {
        return Err(RigError::Invalid("Skin data must hold four influences per vertex.".into()));
    }
    if morph_deltas.len() != morph_count * vertices * 3 {
        return Err(RigError::Invalid("Morph deltas must hold one triple per vertex per morph.".into()));
    }
    let morphs = if vertices == 0 {
        vec![Vec::new(); morph_count]
    } else {
        morph_deltas.chunks_exact(vertices * 3).map(|deltas| triples(deltas, "Morph deltas")).collect::<Result<_, _>>()?
    };
    if channels.len() % 5 != 0 {
        return Err(RigError::Invalid("Channels are rows of kind, control, target, axis, gain.".into()));
    }
    let channels = channels
        .chunks_exact(5)
        .map(|row| {
            let control = index(row[1], "A channel control")?;
            let target = index(row[2], "A channel target")?;
            match row[0] as i32 {
                0 => Ok(Channel::BoneScale { control, bone: target, axis: index(row[3], "A channel axis")?, gain: row[4] }),
                1 => Ok(Channel::Morph { control, morph: target, gain: row[4] }),
                _ => Err(RigError::Invalid("A channel kind must be 0 (bone scale) or 1 (morph).".into())),
            }
        })
        .collect::<Result<_, _>>()?;
    if control_bounds.len() % 2 != 0 {
        return Err(RigError::Invalid("Control bounds are low, high pairs.".into()));
    }
    let control_bounds = control_bounds.chunks_exact(2).map(|pair| [pair[0], pair[1]]).collect();
    if group_offsets.is_empty() || *group_offsets.last().unwrap() as usize != group_members.len() {
        return Err(RigError::Invalid("Group offsets must end at the member count.".into()));
    }
    let groups = group_offsets
        .windows(2)
        .map(|span| {
            if span[0] > span[1] {
                return Err(RigError::Invalid("Group offsets must not decrease.".into()));
            }
            Ok(group_members[span[0] as usize..span[1] as usize].iter().map(|&v| v as usize).collect())
        })
        .collect::<Result<_, _>>()?;
    if measures.len() % 4 != 0 {
        return Err(RigError::Invalid("Measures are rows of kind, a, b, axis.".into()));
    }
    let measures = measures
        .chunks_exact(4)
        .map(|row| {
            let (a, b, axis) = (row[1] as usize, row[2] as usize, row[3] as usize);
            match row[0] {
                0 => Ok(Measure::Extent { group: a, axis }),
                1 => Ok(Measure::Max { group: a, axis }),
                2 => Ok(Measure::Between { from: a, to: b, axis }),
                _ => Err(RigError::Invalid("A measure kind must be 0, 1, or 2.".into())),
            }
        })
        .collect::<Result<_, _>>()?;

    let rig = Rig {
        parents: parents.to_vec(),
        heads: triples(heads, "Bone heads")?,
        inherit_scale: inherit_scale.iter().map(|&flag| flag != 0).collect(),
        positions,
        skin_bones: skin_bones.chunks_exact(4).map(|s| [s[0] as usize, s[1] as usize, s[2] as usize, s[3] as usize]).collect(),
        skin_weights: skin_weights.chunks_exact(4).map(|w| [w[0], w[1], w[2], w[3]]).collect(),
        morphs,
        channels,
        control_bounds,
        groups,
        measures,
        hull_group: hull_group as usize,
    };
    rig.validate()?;
    Ok(rig)
}

fn js(error: RigError) -> JsError {
    JsError::new(&error.to_string())
}

#[wasm_bindgen]
pub struct Kernel {
    rig: Rig,
}

#[wasm_bindgen]
impl Kernel {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        parents: &[i32],
        heads: &[f64],
        inherit_scale: &[u8],
        positions: &[f64],
        skin_bones: &[u32],
        skin_weights: &[f64],
        morph_count: usize,
        morph_deltas: &[f64],
        channels: &[f64],
        control_bounds: &[f64],
        group_offsets: &[u32],
        group_members: &[u32],
        measures: &[u32],
        hull_group: u32,
    ) -> Result<Kernel, JsError> {
        decode_rig(
            parents, heads, inherit_scale, positions, skin_bones, skin_weights, morph_count, morph_deltas, channels, control_bounds,
            group_offsets, group_members, measures, hull_group,
        )
        .map(|rig| Kernel { rig })
        .map_err(js)
    }

    #[wasm_bindgen(getter, js_name = controlCount)]
    pub fn control_count(&self) -> usize {
        self.rig.control_count()
    }

    #[wasm_bindgen(getter, js_name = measureCount)]
    pub fn measure_count(&self) -> usize {
        self.rig.measures.len()
    }

    fn check_controls(&self, controls: &[f64]) -> Result<(), JsError> {
        if controls.len() == self.rig.control_count() && controls.iter().all(|value| value.is_finite()) {
            Ok(())
        } else {
            Err(JsError::new("Pass one finite value per control."))
        }
    }

    /// Local bone scales for three.js (x, y, z per bone) followed by morph weights.
    pub fn pose(&self, controls: &[f64]) -> Result<Vec<f64>, JsError> {
        self.check_controls(controls)?;
        let pose = self.rig.pose(controls);
        Ok(pose.bone_scales.iter().flatten().copied().chain(pose.morph_weights).collect())
    }

    /// Measures followed by the six bounds (min xyz, max xyz).
    pub fn evaluate(&self, controls: &[f64]) -> Result<Vec<f64>, JsError> {
        self.check_controls(controls)?;
        let evaluation = self.rig.evaluate(controls);
        Ok(evaluation.measures.into_iter().chain(evaluation.bounds).collect())
    }

    /// Solves for controls. `targets` holds NaN for free measures. Returns the
    /// controls, then the measures, the six bounds, the iteration count, and
    /// the largest remaining error in rig units.
    pub fn solve(&self, targets: &[f64], initial: &[f64], prior: &[f64], prior_weight: f64, tolerance: f64) -> Result<Vec<f64>, JsError> {
        self.check_controls(initial)?;
        self.check_controls(prior)?;
        let targets: Vec<Option<f64>> = targets.iter().map(|&t| if t.is_nan() { None } else { Some(t) }).collect();
        let solution = self
            .rig
            .solve(&Problem { targets: &targets, initial, prior, prior_weight, tolerance })
            .map_err(js)?;
        Ok(solution
            .controls
            .into_iter()
            .chain(solution.evaluation.measures)
            .chain(solution.evaluation.bounds)
            .chain([solution.iterations as f64, solution.max_error])
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::decode_rig;

    #[test]
    fn decodes_the_flat_layout() {
        let rig = decode_rig(
            &[-1],
            &[0.0, 0.0, 0.0],
            &[1],
            &[0.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            &[0, 0, 0, 0, 0, 0, 0, 0],
            &[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
            0,
            &[],
            &[0.0, 0.0, 0.0, 2.0, 1.0],
            &[0.5, 2.0],
            &[0, 2],
            &[0, 1],
            &[0, 0, 0, 2],
            0,
        )
        .unwrap();
        assert_eq!(rig.evaluate(&[1.5]).measures, vec![1.5]);
    }

    #[test]
    fn rejects_ragged_arrays() {
        let result = decode_rig(&[-1], &[0.0, 0.0, 0.0], &[1], &[0.0, 0.0], &[], &[], 0, &[], &[], &[], &[0], &[], &[], 0);
        assert!(result.is_err());
    }
}
