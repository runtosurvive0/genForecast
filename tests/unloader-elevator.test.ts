import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { animateMachinery, detachMotion } from '../src/components/fuel-scene/coal-flow-effect.js';

// berth-machinery.js unloader(): 하역기(축척 .53) → 승강기(머리 위치·회전) → 버킷 묶음(motion='elevator')
function unloaderLike() {
  const root = new THREE.Group();
  const g = new THREE.Group(); g.position.set(10, 0, 5); g.scale.setScalar(.53); root.add(g);
  const elevator = new THREE.Group(); elevator.position.set(1.4, 40.6, 22.9); elevator.rotation.y = -.32; g.add(elevator);
  const buckets = new THREE.Group(); buckets.userData.motion = 'elevator'; elevator.add(buckets);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(.55, .65, 2.6));
    m.position.set(i < 12 ? 1.2 : -1.2, -18.2 + (i % 12) * 1.5, 0); buckets.add(m);
  }
  return { root, g, elevator, buckets };
}
const worldOf = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

test('하역 중에도 CSU 버킷은 승강기 기둥 안에서만 돈다(분리되지 않음)', () => {
  const { root, g, elevator, buckets } = unloaderLike();
  root.updateMatrixWorld(true);
  const [low, high] = [-18.2, -1.7].map(y => elevator.localToWorld(new THREE.Vector3(0, y, 0)));
  const moving = detachMotion(g);
  assert.deepEqual(moving, [buckets]);
  for (const clock of [0, 1234, 98765]) {
    animateMachinery(THREE, moving, clock, 1200);
    root.updateMatrixWorld(true);
    for (const m of buckets.children) {
      assert.equal(Math.abs(m.position.x), 1.2);
      assert.equal(m.position.z, 0);
      assert.ok(m.position.y >= -18.2 - 1e-9 && m.position.y <= -1.7 + 1e-9, `y=${m.position.y}`);
      const w = worldOf(m);
      assert.ok(w.y >= low.y - .5 && w.y <= high.y + .5, `world y ${w.y}`);
      assert.ok(Math.hypot(w.x - low.x, w.z - low.z) < 1, `bucket off column by ${Math.hypot(w.x - low.x, w.z - low.z)}`);
    }
  }
});

test('하역이 없으면 버킷 배치를 그대로 둔다', () => {
  const { g, buckets } = unloaderLike();
  const before = buckets.children.map(m => m.position.toArray());
  animateMachinery(THREE, detachMotion(g), 5000, 0);
  assert.deepEqual(buckets.children.map(m => m.position.toArray()), before);
});
