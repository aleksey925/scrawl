import { pagePersistence } from '../themePersistence';
import { applyChoiceAttributes, autoChoice } from '../themes';

// the first script of a page of a site, run before the body is read: the page
// opens in the theme picked and the markup kept for a reader without
// javascript stays out of sight, since the app is about to draw the page
document.documentElement.classList.add('scrawl-js');
applyChoiceAttributes(pagePersistence().read() ?? autoChoice);
