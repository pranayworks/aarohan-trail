package com.aarohan.driver;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * The Aarohan home screen widget (shared by both apps). Its texts come from app/src/rider and app/src/driver:
 *   rider:  [Book a ride] [Send a parcel]      driver: [Go online] [Earnings]
 * It always shows live data inside the app itself, so the widget is a quick door into the app.
 */
public class AarohanWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.aarohan_widget);
            views.setOnClickPendingIntent(R.id.widget_root, open(context, "", 0));
            views.setOnClickPendingIntent(R.id.widget_action_a, open(context, context.getString(R.string.widget_go_a), 1));
            views.setOnClickPendingIntent(R.id.widget_action_b, open(context, context.getString(R.string.widget_go_b), 2));
            manager.updateAppWidget(id, views);
        }
    }

    private PendingIntent open(Context context, String go, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (go != null && go.length() > 0) intent.putExtra("aarohan_go", go);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
