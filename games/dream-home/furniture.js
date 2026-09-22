/* dream-home furniture module — STUB (implemented by parallel build session).
   Contract with game.js:
     DH.furniture.init(state)         – called once at load
     DH.furniture.start(state)        – called when a run starts
     DH.furniture.update(dt, state)   – per frame (sim)
     DH.furniture.interactables(p)    – -> [{label,x,y,action}] for the action key
     DH.furniture.collectDraws(draws, camX, camY) – push {y, fn} for depth-sorted render
     DH.furniture.drawOverlay(ctx, camX, camY, state) – optional topmost draw
   Placed furniture should add its tiles to DH.world.blocked ("x,y") and
   contribute to state.happiness. Buying costs state.coins via DH.toast feedback.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  DH.furniture = {
    init() {}, start() {}, update() {},
    interactables() { return []; },
    collectDraws() {}, drawOverlay() {},
  };
})();
