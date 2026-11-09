package com.aarohan.driver;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * Shared by both apps (Aarohan and Aarohan Captain).
 * When a widget button or an app-icon shortcut opens the app, it passes one short word ("ride", "parcel", "online",
 * "earnings"). The web app reads it from window.__aarohanGo and opens the matching screen once it has loaded.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        deliver(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        deliver(intent);
    }

    /** Only these four words are ever passed on, nothing else from the outside reaches the web page. */
    private static String allowed(Intent intent) {
        if (intent == null) return null;
        String go = intent.getStringExtra("aarohan_go");
        if ("ride".equals(go) || "parcel".equals(go) || "online".equals(go) || "earnings".equals(go)) return go;
        return null;
    }

    private void deliver(Intent intent) {
        final String go = allowed(intent);
        if (go == null) return;
        final long stamp = System.currentTimeMillis();
        final Handler handler = new Handler(Looper.getMainLooper());
        // The page may still be loading, so offer the word a few times. The web app ignores a stamp it has already used.
        long[] delays = {800L, 2500L, 5000L, 9000L};
        for (long delay : delays) {
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    try {
                        WebView web = getBridge() != null ? getBridge().getWebView() : null;
                        if (web != null) {
                            web.evaluateJavascript("window.__aarohanGo='" + go + "';window.__aarohanGoStamp=" + stamp + ";", null);
                        }
                    } catch (Exception ignored) {
                        // the app is closing or the page is not ready, nothing to do
                    }
                }
            }, delay);
        }
    }
}
