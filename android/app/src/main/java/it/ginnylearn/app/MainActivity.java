package it.ginnylearn.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.pm.ActivityInfo;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;

import java.io.File;

/**
 * Guscio di GinnyLearn: una WebView a schermo intero che apre il sito di GitHub Pages.
 * Gli aggiornamenti dell'app arrivano dal sito; l'APK va reinstallato solo se cambia questo guscio.
 */
public class MainActivity extends Activity {
    static final String SITO = "https://malefixz-m.github.io/GinnyLearn/";
    static final String HOST = "malefixz-m.github.io";
    private static final int RIC_FILE = 1;

    private WebView web;
    private ValueCallback<Uri[]> attesaFile;
    private Uri fotoUri;
    private File fotoFile;

    @Override
    protected void onCreate(Bundle stato) {
        super.onCreate(stato);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage (progressi)
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // suoni senza tocco
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " GinnyApp/" + BuildConfigLite.versione(this));

        web.addJavascriptInterface(new Ponte(), "GinnyApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (stato != null) web.restoreState(stato);
        else web.loadUrl(indirizzo(getIntent()));

        schermoIntero();
        chiediPermessoNotifiche();
        ControlloCompiti.programma(this);
    }

    private static String indirizzo(Intent i) {
        String h = i == null ? null : i.getStringExtra("apri");
        return SITO + "index.html" + (h != null && h.startsWith("#/") ? h : "");
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        String h = i.getStringExtra("apri");
        if (h != null && h.startsWith("#/")) {
            web.evaluateJavascript("location.hash=" + org.json.JSONObject.quote(h), null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); schermoIntero(); }

    @Override
    protected void onPause() { web.onPause(); super.onPause(); }

    @Override
    public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) schermoIntero(); }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @SuppressWarnings("deprecation")
    private void schermoIntero() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private void chiediPermessoNotifiche() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2);
        }
    }

    /* ---- link: quelli del sito restano dentro, gli altri si aprono fuori ---- */
    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (HOST.equalsIgnoreCase(u.getHost())) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
            return true;
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame()) return;
            String html = "<html><body style='font-family:sans-serif;text-align:center;padding:60px 20px;background:#FDFDF8;color:#1B2A6B'>"
                    + "<h1 style='font-size:28px'>Manca internet 📡</h1>"
                    + "<p style='font-size:20px'>Per la prima apertura serve la connessione.</p>"
                    + "<button style='font-size:22px;padding:12px 28px;border-radius:999px;border:3px solid #1B2A6B;background:#FFD23F;font-weight:bold' "
                    + "onclick='GinnyApp.riprova()'>Riprova</button></body></html>";
            v.loadDataWithBaseURL(SITO, html, "text/html", "utf-8", null);
        }
    }

    /* ---- bottone 📷: fotocamera o galleria ---- */
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (attesaFile != null) attesaFile.onReceiveValue(null);
            attesaFile = cb;

            Intent galleria = new Intent(Intent.ACTION_GET_CONTENT);
            galleria.addCategory(Intent.CATEGORY_OPENABLE);
            galleria.setType("image/*");

            Intent camera = null;
            try {
                File cartella = new File(getCacheDir(), "foto");
                cartella.mkdirs();
                fotoFile = new File(cartella, "scatto.jpg");
                if (fotoFile.exists()) fotoFile.delete();
                fotoUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".file", fotoFile);
                camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, fotoUri);
                camera.setClipData(ClipData.newRawUri("foto", fotoUri));
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception e) {
                fotoUri = null;
            }

            Intent scelta = Intent.createChooser(galleria, "Scegli la foto");
            if (camera != null) scelta.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
            try {
                startActivityForResult(scelta, RIC_FILE);
            } catch (Exception e) {
                attesaFile.onReceiveValue(null);
                attesaFile = null;
            }
            return true;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int req, int ris, Intent dati) {
        super.onActivityResult(req, ris, dati);
        if (req != RIC_FILE || attesaFile == null) return;
        Uri[] r = null;
        if (ris == RESULT_OK) {
            if (dati != null && dati.getData() != null) r = new Uri[]{dati.getData()};
            else if (fotoUri != null && fotoFile != null && fotoFile.length() > 0) r = new Uri[]{fotoUri};
        }
        attesaFile.onReceiveValue(r);
        attesaFile = null;
    }

    /* ---- funzioni chiamabili dalla pagina: window.GinnyApp ---- */
    private class Ponte {
        @JavascriptInterface public String versione() { return BuildConfigLite.versione(MainActivity.this); }

        @JavascriptInterface public boolean notificheAttive() {
            return NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled();
        }

        @JavascriptInterface public void provaNotifica() {
            ControlloCompiti.notifica(MainActivity.this, "🔔 Prova", "Le notifiche dei compiti funzionano!");
        }

        /** controlla subito i compiti (come alle 16 e alle 23) */
        @JavascriptInterface public void controllaOra() { ControlloCompiti.subito(MainActivity.this); }

        // Zaino: 'orizzontale' = lato lungo e rotazione bloccata; 'libero' = segue il tablet
        @JavascriptInterface public void orientamento(String modo) {
            final int o = "orizzontale".equals(modo) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
            runOnUiThread(() -> setRequestedOrientation(o));
        }

        @JavascriptInterface public void riprova() {
            runOnUiThread(() -> web.loadUrl(SITO + "index.html"));
        }
    }
}
