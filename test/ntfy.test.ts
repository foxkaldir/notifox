import { describe, expect, it } from 'vitest';
import { isNtfyTopicUrl } from '../src/integrations/ntfy';

describe('ntfy topic URLs', () => {
  it.each(['https://ntfy.sh/afml98o23uf9q8a23jfa', 'http://localhost:8080/my_topic-1', 'https://ntfy.sh/topic?auth=QmVhcmVyIHRrX3Rlc3Q'])('accepts %s', (url) => {
    expect(isNtfyTopicUrl(url)).toBe(true);
  });
  it.each(['', 'https://ntfy.sh', 'https://ntfy.sh/', 'not a URL', 'ftp://ntfy.sh/topic', 'https://ntfy.sh/topic/json', 'https://ntfy.sh/?auth=QmVhcmVyIHRrX3Rlc3Q'])('rejects %s', (url) => {
    expect(isNtfyTopicUrl(url)).toBe(false);
  });
});
