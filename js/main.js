(function () {
  window.addEventListener('load', function () {
    DC.Engine.start();
    if (DC.Editions) DC.Editions.init();
  });
})();
