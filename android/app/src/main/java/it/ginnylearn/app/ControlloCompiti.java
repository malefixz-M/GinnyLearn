package it.ginnylearn.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Notifiche dei compiti senza Chrome.
 * Un lavoro di WorkManager gira circa ogni ora; controlla davvero solo una volta dopo le 16 e una dopo le 23
 * (se il tablet era spento o senza rete recupera alla prima occasione).
 * Legge "ponte" da contenuti.json, scarica /compiti e avvisa se ci sono compiti nuovi o cambiati.
 */
public class ControlloCompiti extends Worker {
    private static final String CANALE = "compiti";
    private static final String NOME_LAVORO = "controllo-compiti";
    private static final int[] ORE = {16, 23};

    public ControlloCompiti(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    static void programma(Context c) {
        Constraints vincoli = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest r = new PeriodicWorkRequest.Builder(ControlloCompiti.class, 1, TimeUnit.HOURS)
                .setConstraints(vincoli).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(NOME_LAVORO, ExistingPeriodicWorkPolicy.KEEP, r);
    }

    static void subito(Context c) {
        OneTimeWorkRequest r = new OneTimeWorkRequest.Builder(ControlloCompiti.class)
                .setInputData(new Data.Builder().putBoolean("forza", true).build()).build();
        WorkManager.getInstance(c).enqueue(r);
    }

    /** ultimo orario di controllo già passato (16 o 23 di oggi, o 23 di ieri), in millisecondi */
    private static long ultimoTurno() {
        Calendar ora = Calendar.getInstance();
        for (int i = ORE.length - 1; i >= 0; i--) {
            Calendar t = (Calendar) ora.clone();
            t.set(Calendar.HOUR_OF_DAY, ORE[i]); t.set(Calendar.MINUTE, 5); t.set(Calendar.SECOND, 0); t.set(Calendar.MILLISECOND, 0);
            if (!t.after(ora)) return t.getTimeInMillis();
        }
        Calendar ieri = (Calendar) ora.clone();
        ieri.add(Calendar.DAY_OF_MONTH, -1);
        ieri.set(Calendar.HOUR_OF_DAY, ORE[ORE.length - 1]); ieri.set(Calendar.MINUTE, 5); ieri.set(Calendar.SECOND, 0); ieri.set(Calendar.MILLISECOND, 0);
        return ieri.getTimeInMillis();
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        SharedPreferences sp = c.getSharedPreferences("compiti", Context.MODE_PRIVATE);
        boolean forza = getInputData().getBoolean("forza", false);
        long turno = ultimoTurno();
        if (!forza && sp.getLong("turno", 0) >= turno) return Result.success();
        try {
            String ponte = new JSONObject(scarica(MainActivity.SITO + "data/contenuti.json?t=" + System.currentTimeMillis()))
                    .optString("ponte", "");
            if (ponte.isEmpty()) return Result.success();
            JSONArray compiti = new JSONObject(scarica(ponte + (ponte.contains("?") ? "&" : "?") + "fresco"))
                    .getJSONArray("compiti");

            JSONObject ora = new JSONObject();
            for (int i = 0; i < compiti.length(); i++) {
                JSONObject x = compiti.getJSONObject(i);
                ora.put(x.optString("id"), x.optString("data") + "|" + x.optString("materia") + "|" + x.optString("testo"));
            }
            String primaTesto = sp.getString("visti", null);
            if (primaTesto != null) {
                JSONObject prima = new JSONObject(primaTesto);
                List<String> righe = new ArrayList<>();
                int nuovi = 0, cambiati = 0;
                for (Iterator<String> it = ora.keys(); it.hasNext(); ) {
                    String id = it.next(), v = ora.getString(id);
                    if (!prima.has(id)) nuovi++;
                    else if (!prima.getString(id).equals(v)) cambiati++;
                    else continue;
                    String[] p = v.split("\\|", 3);
                    if (righe.size() < 4 && p.length == 3) {
                        String r = p[1] + ": " + p[2];
                        righe.add(r.length() > 80 ? r.substring(0, 80) + "…" : r);
                    }
                }
                if (nuovi + cambiati > 0) {
                    List<String> parti = new ArrayList<>();
                    if (nuovi > 0) parti.add(nuovi == 1 ? "1 compito nuovo" : nuovi + " compiti nuovi");
                    if (cambiati > 0) parti.add(cambiati == 1 ? "1 compito cambiato" : cambiati + " compiti cambiati");
                    notifica(c, "📒 " + String.join(" e ", parti), String.join("\n", righe));
                }
            } else if (forza) {
                notifica(c, "📒 Compiti controllati", "Da ora ti avviso quando arrivano compiti nuovi");
            }
            sp.edit().putString("visti", ora.toString()).putLong("turno", turno).apply();
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    private static String scarica(String indirizzo) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(indirizzo).openConnection();
        h.setConnectTimeout(20000);
        h.setReadTimeout(30000);
        h.setUseCaches(false);
        h.setRequestProperty("Accept", "application/json");
        try {
            if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
            try (InputStream in = h.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                int n;
                while ((n = in.read(b)) > 0) out.write(b, 0, n);
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally {
            h.disconnect();
        }
    }

    static void notifica(Context c, String titolo, String testo) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CANALE, "Compiti", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Avvisi dei compiti nuovi alle 16 e alle 23");
            c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        Intent i = new Intent(c, MainActivity.class)
                .putExtra("apri", "#/compiti")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CANALE)
                .setSmallIcon(R.drawable.ic_notifica)
                .setContentTitle(titolo)
                .setContentText(testo)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(testo))
                .setContentIntent(pi)
                .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(c).notify(1, n.build());
        } catch (SecurityException e) {
            // permesso notifiche non concesso
        }
    }
}
