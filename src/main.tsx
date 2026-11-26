import { render } from "preact";

import { App } from "./app";
import "./styles/index.css";
import { bootTelegram, getWebApp } from "./telegram/webapp";
import { applyTheme, readThemeMode } from "./theme/apply";

const webapp = getWebApp();

// `ready()` and `expand()` belong before the first meaningful paint; the theme
// is applied once here and again on `themeChanged` and manual overrides.
bootTelegram(webapp);
applyTheme(readThemeMode(), webapp);

const root = document.getElementById("app");
if (root) render(<App webapp={webapp} />, root);
