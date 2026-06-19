package com.fibuladreams.atlas;

import android.Manifest;
import android.content.Context;
import android.content.res.AssetManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(
  name = "OfflineSpeech",
  permissions = {
    @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "speech")
  }
)
public class OfflineSpeechPlugin extends Plugin {
  private static final String MODEL_ASSET_NAME = "vosk-model-small-en-us-0.15.zip";
  private static final String MODEL_DIR_NAME = "vosk-model-small-en-us-0.15";
  private static final String READY_MARKER = ".ready";

  private static final Object MODEL_LOCK = new Object();
  private static volatile Model sharedModel;

  private SpeechService speechService;
  private Recognizer recognizer;
  private boolean listening;
  private boolean finalResultEmitted;

  @PluginMethod
  public void available(PluginCall call) {
    JSObject result = new JSObject();
    result.put("available", assetExists());
    call.resolve(result);
  }

  @PluginMethod
  public void start(PluginCall call) {
    if (getPermissionState("speech") != PermissionState.GRANTED) {
      requestPermissionForAlias("speech", call, "speechPermsCallback");
      return;
    }

    new Thread(() -> {
      try {
        startListening();
        call.resolve();
      } catch (Exception e) {
        call.reject(e.getMessage() != null ? e.getMessage() : "Failed to start offline speech", e);
      }
    }).start();
  }

  @PermissionCallback
  private void speechPermsCallback(PluginCall call) {
    if (getPermissionState("speech") == PermissionState.GRANTED) {
      start(call);
      return;
    }

    call.reject("Microphone permission is required for offline speech");
  }

  @PluginMethod
  public void stop(PluginCall call) {
    stopListening();
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    stopListening();
    super.handleOnDestroy();
  }

  private void startListening() throws Exception {
    stopListening();
    finalResultEmitted = false;

    Model model = getSharedModel();
    recognizer = new Recognizer(model, 16000.0f);
    speechService = new SpeechService(recognizer, 16000.0f);
    listening = true;

    notifyListeningState("started");

    speechService.startListening(new RecognitionListener() {
      @Override
      public void onPartialResult(String hypothesis) {
        emitTranscript("partialResults", extractText(hypothesis, "partial"));
      }

      @Override
      public void onResult(String hypothesis) {
        emitFinalTranscript(extractText(hypothesis, "text"));
      }

      @Override
      public void onFinalResult(String hypothesis) {
        emitFinalTranscript(extractText(hypothesis, "text"));
        stopListening();
      }

      @Override
      public void onError(Exception exception) {
        JSObject payload = new JSObject();
        payload.put("message", exception.getMessage());
        notifyListeners("error", payload, false);
        stopListening();
      }

      @Override
      public void onTimeout() {
        stopListening();
      }
    });
  }

  private void stopListening() {
    SpeechService currentService = speechService;
    speechService = null;
    recognizer = null;
    boolean wasListening = listening;
    listening = false;

    if (currentService != null) {
      try {
        currentService.stop();
      } catch (Exception ignored) {
      }

      try {
        currentService.shutdown();
      } catch (Exception ignored) {
      }
    }

    if (wasListening) {
      notifyListeningState("stopped");
    }
  }

  private void notifyListeningState(String status) {
    JSObject payload = new JSObject();
    payload.put("status", status);
    notifyListeners("listeningState", payload, false);
  }

  private void emitFinalTranscript(String transcript) {
    String cleaned = transcript == null ? "" : transcript.trim();
    if (cleaned.isEmpty() || finalResultEmitted) {
      return;
    }

    finalResultEmitted = true;
    emitTranscript("finalResult", cleaned);
  }

  private void emitTranscript(String eventName, String transcript) {
    String cleaned = transcript == null ? "" : transcript.trim();
    if (cleaned.isEmpty()) {
      return;
    }

    JSObject payload = new JSObject();
    payload.put("text", cleaned);
    JSArray matches = new JSArray();
    matches.put(cleaned);
    payload.put("matches", matches);
    notifyListeners(eventName, payload, false);
  }

  private String extractText(String hypothesis, String key) {
    try {
      JSONObject parsed = new JSONObject(hypothesis);
      return parsed.optString(key, "");
    } catch (JSONException e) {
      return "";
    }
  }

  private Model getSharedModel() throws IOException {
    Model model = sharedModel;
    if (model != null) {
      return model;
    }

    synchronized (MODEL_LOCK) {
      if (sharedModel != null) {
        return sharedModel;
      }

      File modelDir = ensureModelExtracted(getContext());
      sharedModel = new Model(modelDir.getAbsolutePath());
      return sharedModel;
    }
  }

  private File ensureModelExtracted(Context context) throws IOException {
    File targetDir = new File(context.getFilesDir(), MODEL_DIR_NAME);
    File readyMarker = new File(targetDir, READY_MARKER);

    if (readyMarker.exists()) {
      return targetDir;
    }

    deleteRecursively(targetDir);
    if (!targetDir.mkdirs() && !targetDir.isDirectory()) {
      throw new IOException("Unable to create offline speech directory");
    }

    AssetManager assets = context.getAssets();
    try (InputStream inputStream = assets.open(MODEL_ASSET_NAME);
      ZipInputStream zipInputStream = new ZipInputStream(inputStream)) {
      ZipEntry entry;
      byte[] buffer = new byte[8192];

      while ((entry = zipInputStream.getNextEntry()) != null) {
        String entryName = entry.getName();
        if (entryName.startsWith(MODEL_DIR_NAME + "/")) {
          entryName = entryName.substring(MODEL_DIR_NAME.length() + 1);
        }

        if (entryName.isEmpty()) {
          zipInputStream.closeEntry();
          continue;
        }

        File outFile = new File(targetDir, entryName);

        if (entry.isDirectory()) {
          if (!outFile.mkdirs() && !outFile.isDirectory()) {
            throw new IOException("Unable to create directory " + outFile.getAbsolutePath());
          }
        } else {
          File parent = outFile.getParentFile();
          if (parent != null && !parent.exists() && !parent.mkdirs() && !parent.isDirectory()) {
            throw new IOException("Unable to create directory " + parent.getAbsolutePath());
          }

          try (FileOutputStream outputStream = new FileOutputStream(outFile)) {
            int read;
            while ((read = zipInputStream.read(buffer)) != -1) {
              outputStream.write(buffer, 0, read);
            }
          }
        }

        zipInputStream.closeEntry();
      }
    }

    if (!readyMarker.createNewFile() && !readyMarker.exists()) {
      throw new IOException("Unable to mark offline speech model as ready");
    }

    return targetDir;
  }

  private boolean assetExists() {
    try {
      getContext().getAssets().open(MODEL_ASSET_NAME).close();
      return true;
    } catch (IOException e) {
      return false;
    }
  }

  private void deleteRecursively(File file) {
    if (file == null || !file.exists()) {
      return;
    }

    File[] children = file.listFiles();
    if (children != null) {
      for (File child : children) {
        deleteRecursively(child);
      }
    }

    //noinspection ResultOfMethodCallIgnored
    file.delete();
  }
}
