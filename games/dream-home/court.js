/* dream-home court module — STUB (parallel build session).
   Contract: init/start/update(dt,state)/interactables(p)/collectDraws(draws,camX,camY)/
   drawGround(ctx,camX,camY,state)/drawOverlay/serialize/deserialize/remoteAction.
   Season: DH.state.season is 'spring'|'summer'|'autumn'|'winter' (winter → ice rink). */
(function () {
  const DH = (window.DH = window.DH || {});
  DH.court = {
    init() {}, start() {}, update() {},
    interactables() { return []; },
    collectDraws() {}, drawGround() {}, drawOverlay() {},
    serialize() { return {}; }, deserialize() {}, remoteAction() {},
  };
})();
