// Read-only audit: executes the same statureTargets + WASM solve as HumanModel.
// Writes stature-fixed-rig.json; baseline stature-panel-rig.json is preserved.
// Reproduce: node --experimental-strip-types .audit/stature-panel-rig.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { HUMAN_CATALOG } from '../src/catalog/humans.ts';
import * as THREE from 'three';
import { statureTargets, STATURE_TOLERANCE_MM } from '../src/domain/stature.ts';
import { RigSolver, loadKernel } from '../src/kernel/index.ts';

await loadKernel(readFileSync(new URL('../src/kernel/pkg/kernel_bg.wasm', import.meta.url)));
const report = {
  meaning: 'World bone scales are lengths of the transformed anatomical basis axes, relative to authored geometry. Human arm Y is length, X/Z are transverse dimensions. Area and volume are geometric multiples, not body mass.',
  caveat: 'chestWidth and ratios containing ChestWidth refer to the chest bone transverse scale, not measured thorax width. Arm-girth ratios apply exactly only within regions fully assigned to an arm bone; blended shoulders differ.',
  measurements: [],
};
for (const entry of HUMAN_CATALOG) {
  const rig = JSON.parse(readFileSync(new URL(`../public/models/${entry.id}.rig.json`, import.meta.url))).rigs[0];
  const solver = new RigSolver(rig);
  const authoredMm = Object.fromEntries(Object.entries(solver.evaluate().measures).map(([name, value]) => [name, value * 1000]));
  const samples = [];
  for (const heightMm of [900, authoredMm.stature, 2000, 2400, 3048]) {
    const targetMm = statureTargets(entry.sex, authoredMm, heightMm);
    const solution = solver.solve(Object.fromEntries(Object.entries(targetMm).map(([name, value]) => [name, value / 1000])), { tolerance: STATURE_TOLERANCE_MM / 1000 });
    const pose = solver.pose(solution.controls);
    const worldScales = {}, worldMatrices = {};
    rig.bones.forEach((bone, index) => {
      const local = new THREE.Matrix4().fromArray(pose.boneMatrices[index]);
      const world = bone.parent === null ? local : new THREE.Matrix4().multiplyMatrices(worldMatrices[bone.parent], local);
      worldMatrices[bone.name] = world;
      const linear = new THREE.Matrix3().setFromMatrix4(world);
      const basis = bone.basis ?? [1,0,0,0,1,0,0,0,1];
      worldScales[bone.name] = [0,3,6].map(offset => new THREE.Vector3(...basis.slice(offset,offset+3)).applyMatrix3(linear).length());
    });
    samples.push({
      heightMm, growth: heightMm / authoredMm.stature, maxTargetErrorMm: solution.maxError * 1000,
      targetMm, measuredMm: Object.fromEntries(Object.entries(solution.measures).map(([name,value]) => [name,value*1000])),
      controls: solution.controls,
      localBoneMatrices: Object.fromEntries(rig.bones.map((bone,index)=>[bone.name,pose.boneMatrices[index]])),
      worldBoneScales: worldScales,
      ratiosRelativeToAuthored: {
        headWidth: worldScales.head[0], armGirth: worldScales['arm.L'][0], chestWidth: worldScales.chest[0],
        headToChestWidth: worldScales.head[0] / worldScales.chest[0],
        armGirthToChestWidth: worldScales['arm.L'][0] / worldScales.chest[0],
        headToShoulderBreadth: worldScales.head[0] / (solution.measures.biacromialBreadth * 1000 / authoredMm.biacromialBreadth),
        armGirthToShoulderBreadth: worldScales['arm.L'][0] / (solution.measures.biacromialBreadth * 1000 / authoredMm.biacromialBreadth),
        pureArmCrossSectionArea: worldScales['arm.L'][0] ** 2,
        pureHeadVolume: worldScales.head[0] ** 3,
      },
    });
  }
  const landmarkInfluences = Object.fromEntries(['shoulderLeft','neck','ear','crown'].map(name => [name,rig.groups[name].map(vertex=>({point:rig.vertices.positions.slice(vertex*3,vertex*3+3),influences:Array.from({length:4},(_,slot)=>({bone:rig.bones[rig.vertices.skinBones[vertex*4+slot]].name,weight:rig.vertices.skinWeights[vertex*4+slot]})).filter(i=>i.weight>0)}))]));
  report.measurements.push({id:entry.id,label:entry.label,sex:entry.sex,authoredMm,landmarkInfluences,samples});
  solver.dispose();
}
const destination=new URL('./stature-fixed-rig.json',import.meta.url);
writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
console.log(destination.pathname);
for(const model of report.measurements) for(const sample of model.samples) console.log(JSON.stringify({label:model.label,heightMm:sample.heightMm,ratios:sample.ratiosRelativeToAuthored}));
