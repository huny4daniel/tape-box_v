package io.github.huny4daniel.musiccollection;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/** 가사 규칙: 글 없는 시간 가사는 가사로 치지 않고, 만든 싱크 가사에 원본 글자가 얼마나 들어 있는지 센다 */
public class LyricsRulesTest {
    @Test public void timeOnlyLrcHasNoText() {
        List<Id3Lyrics.Line> l = Id3Lyrics.parseLrc("[00:01.00]\n[00:02.00]\n[00:03.00]");
        assertFalse(Id3Lyrics.hasText(l));
        assertTrue(Id3Lyrics.hasText(Id3Lyrics.parseLrc("[00:01.00]하늘\n[00:02.00]")));
        assertFalse(Id3Lyrics.hasText(null));
    }

    @Test public void lettersIgnoreSpacesAndMarks() {
        assertEquals(6, Id3Lyrics.letters("하늘이, 파랗다!"));
        assertEquals(4, Id3Lyrics.letters("a b-c d"));
        List<Id3Lyrics.Line> l = Id3Lyrics.parseLrc("[00:01.00]하늘이 파랗다\n[00:03.00]\n[00:05.00]바람이 분다");
        assertEquals(11, Id3Lyrics.letters(l));
    }
}
