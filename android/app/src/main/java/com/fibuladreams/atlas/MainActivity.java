package com.fibuladreams.atlas;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(OfflineSpeechPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
