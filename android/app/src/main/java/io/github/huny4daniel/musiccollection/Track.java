package io.github.huny4daniel.musiccollection;

import android.content.ContentUris;
import android.net.Uri;
import android.provider.MediaStore;

/** MediaStore에서 읽은 곡 하나. id는 파일이 옮겨지거나 다시 스캔돼도 바뀌지 않게 곡 정보로 만든다. */
public class Track {
    public String id;          // 곡 정보로 만든 고정 키
    public long mediaId;       // MediaStore _ID (스캔할 때마다 바뀔 수 있음)
    public String title, artist, albumArtist, album, albumKey, genre, mime;
    public int year, track, disc;
    public long duration, addedAt, size;

    public Uri uri() {
        return ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId);
    }
}
