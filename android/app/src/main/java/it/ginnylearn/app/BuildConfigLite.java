package it.ginnylearn.app;

import android.content.Context;

/** versione del guscio letta dal pacchetto (evita di dipendere da BuildConfig) */
final class BuildConfigLite {
    private BuildConfigLite() { }

    static String versione(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; }
        catch (Exception e) { return "?"; }
    }
}
