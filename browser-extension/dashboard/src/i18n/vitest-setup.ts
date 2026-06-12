/**
 * Vitest global setup: initialize i18next (defaults to ko) so modules that
 * resolve labels through t() at call time return real Korean strings in tests
 * instead of raw keys.
 */

import { initI18n } from "./index";

initI18n();
