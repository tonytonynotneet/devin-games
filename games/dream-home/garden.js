/* dream-home garden module — STUB (implemented by parallel build session).
   Same contract as furniture.js:
     init(state) / start(state) / update(dt, state)
     interactables(p) -> [{label,x,y,action}]
     collectDraws(draws, camX, camY) / drawOverlay(ctx, camX, camY, state)
   Garden zone: DH.world.zone(tx,ty) === "garden"; soil tiles are DH.world.SOIL.
   Harvest yields state.coins and state.happiness. Crop growth uses state.timeMin.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  DH.garden = {
    init() {}, start() {}, update() {},
    interactables() { return []; },
    collectDraws() {}, drawOverlay() {},
  };
})();
