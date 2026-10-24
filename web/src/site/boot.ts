import { pagePersistence } from '../themePersistence';
import { applyChoiceAttributes, autoChoice } from '../themes';

document.documentElement.classList.add('scrawl-js');
applyChoiceAttributes(pagePersistence().read() ?? autoChoice);
