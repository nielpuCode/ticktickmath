import homeHtml from '../screens/home.html?raw';
import lobbyHtml from '../screens/lobby.html?raw';
import waitHtml from '../screens/wait.html?raw';
import playHtml from '../screens/play.html?raw';
import resultsHtml from '../screens/results.html?raw';
import qrHtml from '../screens/qr.html?raw';
import tutorialHtml from '../screens/tutorial.html?raw';

const app = document.getElementById('app');
if (app) {
  app.innerHTML = homeHtml + lobbyHtml + waitHtml + playHtml + resultsHtml + qrHtml + tutorialHtml;
}

await import('./generator.js');
await import('./names.js');
await import('./multi.js');
await import('./party.js');
await import('./roast.js');
await import('./game-state.js');
await import('./game-solo.js');
await import('./game-multi.js');
await import('./game-boot.js');
await import('./game.js');
