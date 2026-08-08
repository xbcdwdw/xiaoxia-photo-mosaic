package com.photomoasic.android;

import com.getcapacitor.BridgeActivity;
import android.view.KeyEvent;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {

    private boolean jsBridgeInjected = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 页面加载前禁用 WebView 缓存：保证每次安装/更新都加载最新页面
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
            bridge.getWebView().getSettings().setDomStorageEnabled(true);
        }
    }

    // JS 调用的桥：直接用 MediaStore 写入系统相册
    public class GalleryBridge {
        @JavascriptInterface
        public String saveImage(String base64, String fileName) {
            try {
                byte[] imageBytes = Base64.decode(base64, Base64.DEFAULT);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/照片拼图器");
                }

                Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return "ERROR: insert failed";

                OutputStream out = getContentResolver().openOutputStream(uri);
                if (out == null) return "ERROR: openOutputStream failed";

                out.write(imageBytes);
                out.close();

                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                getContentResolver().update(uri, values, null, null);

                return "OK:" + uri.toString();
            } catch (Exception e) {
                return "ERROR:" + e.getMessage();
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // 禁用 WebView 缓存：确保覆盖安装/更新后立即加载最新页面，避免看到旧版 UI
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
            bridge.getWebView().getSettings().setDomStorageEnabled(true);
            // 在 WebView 准备好后注入 JavaScript 接口
            if (!jsBridgeInjected) {
                bridge.getWebView().addJavascriptInterface(new GalleryBridge(), "GalleryBridge");
                jsBridgeInjected = true;
            }
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().evaluateJavascript(
                    "(function(){" +
                    "  var ov = document.querySelector('.full-image-overlay');" +
                    "  if (ov) { ov.remove(); return ''; }" +
                    "  return confirm('确定退出照片拼图器？') ? 'exit' : '';" +
                    "})()",
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            if ("\"exit\"".equals(value)) {
                                finishAffinity();
                            }
                        }
                    }
                );
                return true;
            }
            return super.onKeyDown(keyCode, event);
        }
        return super.onKeyDown(keyCode, event);
    }
}
