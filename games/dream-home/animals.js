/* dream-home animals module — STUB (implemented by parallel build session).
   Same contract as furniture.js:
     init(state) / start(state) / update(dt, state)
     interactables(p) -> [{label,x,y,action}]
     collectDraws(draws, camX, camY) / drawOverlay(ctx, camX, camY, state)
   The household: 1 golden retriever, 3 cats, 3 chickens, 2 sheep, 2 cows, 9 kids.
   Animals wander in the pasture; they get hungry over time (show DH.sprites.sad
   marker ☹️-style when unfed) and feeding restores them. Kids are small NPC
   family members who wander the house/yard and boost happiness when cared for.
   Happy animals + kids raise state.happiness.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  DH.animals = {
    init() {}, start() {}, update() {},
    interactables() { return []; },
    collectDraws() {}, drawOverlay() {},
  };
})();
