/* Corre el cálculo de letal en segundo plano para que la pantalla no se trabe. */
importScripts('letal-engine.js');
self.onmessage = function (e) {
  var o;
  try { o = { id: e.data.id, out: Engine.analyze(e.data.state) }; }
  catch (err) { o = { id: e.data.id, error: String((err && err.message) || err) }; }
  self.postMessage(o);
};
