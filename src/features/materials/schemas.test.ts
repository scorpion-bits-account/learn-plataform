import { describe, expect, it } from 'vitest';

import {
  buildStoragePath,
  createMaterialSchema,
  FILE_MAX_BYTES,
  formatBytes,
  isPathInLesson,
  parseVideoUrl,
  sanitizeFileName,
  updateMaterialSchema,
  validateFile,
  videoUrlFor,
} from './schemas';

const COURSE = '11111111-1111-4111-8111-111111111111';
const LESSON = '33333333-3333-4333-8333-333333333333';
const OTHER = '99999999-9999-4999-8999-999999999999';
const UUID = '0b0e2d5a-1111-4222-8333-444455556666';
const DB_VIDEO_ID = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?$/;

describe('parseVideoUrl: URLs válidas', () => {
  const youtube = 'dQw4w9WgXcQ';
  it.each([
    `https://www.youtube.com/watch?v=${youtube}`,
    `https://youtube.com/watch?v=${youtube}&t=10s&list=abc`,
    `https://m.youtube.com/watch?v=${youtube}`,
    `https://youtu.be/${youtube}`,
    `https://youtu.be/${youtube}?si=xyz`,
    `https://www.youtube.com/embed/${youtube}`,
    `https://www.youtube-nocookie.com/embed/${youtube}`,
    `https://www.youtube.com/shorts/${youtube}`,
    `https://www.youtube.com/live/${youtube}`,
    `  http://www.youtube.com/watch?v=${youtube}  `,
  ])('YouTube: %s', (url) => {
    expect(parseVideoUrl(url)).toEqual({ provider: 'youtube', videoId: youtube });
  });

  it.each([
    ['https://vimeo.com/76979871', '76979871'],
    ['https://www.vimeo.com/76979871', '76979871'],
    ['https://vimeo.com/76979871/abcdef1234', '76979871/abcdef1234'],
    ['https://vimeo.com/76979871?h=abcdef1234', '76979871/abcdef1234'],
    ['https://player.vimeo.com/video/76979871', '76979871'],
    ['https://player.vimeo.com/video/76979871?h=abcdef1234&dnt=1', '76979871/abcdef1234'],
    ['https://vimeo.com/channels/staffpicks/76979871', '76979871'],
    ['https://vimeo.com/groups/motion/videos/76979871', '76979871'],
  ])('Vimeo: %s', (url, videoId) => {
    expect(parseVideoUrl(url)).toEqual({ provider: 'vimeo', videoId });
  });

  it('o id devolvido sempre respeita o check do banco', () => {
    for (const url of [`https://youtu.be/dQw4w9WgXcQ`, 'https://vimeo.com/76979871/abcdef1234']) {
      expect(parseVideoUrl(url)?.videoId).toMatch(DB_VIDEO_ID);
    }
  });
});

describe('parseVideoUrl: URLs maliciosas ou de outros sites', () => {
  it.each([
    '',
    '   ',
    'dQw4w9WgXcQ',
    'not a url',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
    'file:///etc/passwd',
    // host que apenas contém/termina com o domínio
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://evilyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be.evil.com/dQw4w9WgXcQ',
    'https://notvimeo.com/76979871',
    'https://vimeo.com.evil.com/76979871',
    // credenciais e porta
    'https://youtube.com@evil.com/watch?v=dQw4w9WgXcQ',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
    // ids fora do formato
    'https://www.youtube.com/watch?v=dQw4w9WgXc',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQQ',
    'https://www.youtube.com/watch?v="><script>',
    'https://www.youtube.com/watch?v=dQw4w9WgX/Q',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/@canal',
    'https://vimeo.com/abc',
    'https://vimeo.com/76979871/hash/extra',
    'https://vimeo.com/76979871/ha<sh',
    'https://vimeo.com/76979871?h=../../x',
    'https://player.vimeo.com/76979871',
  ])('rejeita %j', (url) => {
    expect(parseVideoUrl(url)).toBeNull();
  });

  it('rejeita URL gigante', () => {
    expect(parseVideoUrl(`https://youtu.be/dQw4w9WgXcQ?${'a'.repeat(3000)}`)).toBeNull();
  });
});

describe('videoUrlFor', () => {
  it('reconstrói URLs que parseVideoUrl entende', () => {
    expect(parseVideoUrl(videoUrlFor('youtube', 'dQw4w9WgXcQ')!)).toEqual({
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
    });
    expect(parseVideoUrl(videoUrlFor('vimeo', '76979871/abcdef1234')!)).toEqual({
      provider: 'vimeo',
      videoId: '76979871/abcdef1234',
    });
  });
  it('provedor sem URL pública => null', () => {
    expect(videoUrlFor('bunny', 'lib/vid')).toBeNull();
    expect(videoUrlFor(null, null)).toBeNull();
  });
});

describe('arquivos', () => {
  it('sanitizeFileName só deixa ASCII seguro e preserva a extensão', () => {
    expect(sanitizeFileName('Projeto Final (v2).zip')).toBe(
      'Projeto-Final-v2-.zip'.replace('-.', '.'),
    );
    expect(sanitizeFileName('açúcar & café.PNG')).toBe('acucar-cafe.PNG');
    expect(sanitizeFileName('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeFileName('..')).toBe('arquivo');
    expect(sanitizeFileName('???')).toBe('arquivo');
    expect(sanitizeFileName('a\\b/c\u0000d.zip')).toBe('a-b-c-d.zip');
    expect(sanitizeFileName('.hidden')).toBe('hidden');
    expect(sanitizeFileName(`${'x'.repeat(300)}.zip`).length).toBeLessThanOrEqual(110);
    expect(sanitizeFileName('x.tar..gz')).not.toContain('..');
  });

  it('buildStoragePath segue <curso>/<aula>/<uuid>-<nome> e é aceito por isPathInLesson', () => {
    const path = buildStoragePath(COURSE, LESSON, '../Meu Arquivo.zip', UUID);
    expect(path).toBe(`${COURSE}/${LESSON}/${UUID}-Meu-Arquivo.zip`);
    expect(isPathInLesson(path, COURSE, LESSON)).toBe(true);
  });

  it('isPathInLesson rejeita caminho fora do prefixo, com traversal ou fora do formato', () => {
    const ok = `${COURSE}/${LESSON}/${UUID}-a.zip`;
    expect(isPathInLesson(ok, COURSE, LESSON)).toBe(true);
    expect(isPathInLesson(ok, OTHER, LESSON)).toBe(false);
    expect(isPathInLesson(ok, COURSE, OTHER)).toBe(false);
    expect(isPathInLesson(`${OTHER}/${LESSON}/${UUID}-a.zip`, COURSE, LESSON)).toBe(false);
    expect(isPathInLesson(`/${ok}`, COURSE, LESSON)).toBe(false);
    expect(isPathInLesson(`${COURSE}/${LESSON}/../${OTHER}/${UUID}-a.zip`, COURSE, LESSON)).toBe(
      false,
    );
    expect(isPathInLesson(`${COURSE}/${LESSON}/${UUID}-../a.zip`, COURSE, LESSON)).toBe(false);
    expect(isPathInLesson(`${COURSE}/${LESSON}/sub/${UUID}-a.zip`, COURSE, LESSON)).toBe(false);
    expect(isPathInLesson(`${COURSE}/${LESSON}/a.zip`, COURSE, LESSON)).toBe(false);
    expect(isPathInLesson(`${COURSE}/${LESSON}/${UUID}-a\\b.zip`, COURSE, LESSON)).toBe(false);
    expect(isPathInLesson(`${COURSE}/${LESSON}`, COURSE, LESSON)).toBe(false);
    expect(isPathInLesson('', COURSE, LESSON)).toBe(false);
  });

  it('validateFile confere tipo e tamanho', () => {
    expect(validateFile({ size: 10, type: 'application/zip' })).toBeNull();
    expect(validateFile({ size: 10, type: '' })).toBeNull(); // vira octet-stream
    expect(validateFile({ size: FILE_MAX_BYTES, type: 'image/png' })).toBeNull();
    expect(validateFile({ size: FILE_MAX_BYTES + 1, type: 'image/png' })).toMatch(/200 MB/);
    expect(validateFile({ size: 0, type: 'image/png' })).toMatch(/vazio/);
    for (const type of [
      'application/pdf',
      'text/html',
      'image/svg+xml',
      'application/javascript',
    ]) {
      expect(validateFile({ size: 10, type })).toMatch(/não permitido/);
    }
  });

  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB');
  });
});

describe('createMaterialSchema', () => {
  it('video: URL inválida e título em branco opcional', () => {
    expect(
      createMaterialSchema.safeParse({ type: 'video', lessonId: LESSON, url: 'https://evil.com/x' })
        .success,
    ).toBe(false);
    const ok = createMaterialSchema.parse({
      type: 'video',
      lessonId: LESSON,
      title: '   ',
      url: 'https://youtu.be/dQw4w9WgXcQ',
    });
    expect(ok.title).toBeNull();
  });

  it('link: só http(s) e título obrigatório', () => {
    const base = { type: 'link', lessonId: LESSON, title: 'Docs' };
    expect(createMaterialSchema.safeParse({ ...base, url: 'https://docs.dev/a?b=1' }).success).toBe(
      true,
    );
    expect(createMaterialSchema.safeParse({ ...base, url: 'http://docs.dev' }).success).toBe(true);
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://x.com',
      '//x.com',
      'https://',
      'https://a b.com',
      '',
    ]) {
      expect(createMaterialSchema.safeParse({ ...base, url }).success).toBe(false);
    }
    expect(
      createMaterialSchema.safeParse({ ...base, title: '  ', url: 'https://docs.dev' }).success,
    ).toBe(false);
  });

  it('text: corpo em branco recusado', () => {
    expect(
      createMaterialSchema.safeParse({ type: 'text', lessonId: LESSON, body: '  \n ' }).success,
    ).toBe(false);
    expect(
      createMaterialSchema.safeParse({ type: 'text', lessonId: LESSON, body: '# oi' }).success,
    ).toBe(true);
  });

  it('file: mime fora da lista, tamanho e nome inválidos', () => {
    const file = {
      storagePath: `${COURSE}/${LESSON}/${UUID}-a.zip`,
      fileName: 'a.zip',
      fileSize: 100,
      mimeType: 'application/zip',
    };
    const parse = (patch: object) =>
      createMaterialSchema.safeParse({
        type: 'file',
        lessonId: LESSON,
        file: { ...file, ...patch },
      }).success;
    expect(parse({})).toBe(true);
    expect(parse({ mimeType: 'application/pdf' })).toBe(false);
    expect(parse({ mimeType: 'text/html' })).toBe(false);
    expect(parse({ fileSize: 0 })).toBe(false);
    expect(parse({ fileSize: FILE_MAX_BYTES + 1 })).toBe(false);
    expect(parse({ fileSize: 1.5 })).toBe(false);
    expect(parse({ fileName: '../x.zip' })).toBe(false);
    expect(parse({ fileName: 'a\u0000.zip' })).toBe(false);
  });

  it('exige uuid e tipo conhecido', () => {
    expect(createMaterialSchema.safeParse({ type: 'text', lessonId: 'x', body: 'a' }).success).toBe(
      false,
    );
    expect(createMaterialSchema.safeParse({ type: 'pdf', lessonId: LESSON }).success).toBe(false);
  });
});

describe('showInAllLessons', () => {
  it('create: padrão false, aceita boolean e recusa outros tipos', () => {
    const base = { type: 'text', lessonId: LESSON, body: 'x' };
    expect(createMaterialSchema.parse(base)).toMatchObject({ showInAllLessons: false });
    expect(createMaterialSchema.parse({ ...base, showInAllLessons: true })).toMatchObject({
      showInAllLessons: true,
    });
    expect(createMaterialSchema.safeParse({ ...base, showInAllLessons: 'true' }).success).toBe(
      false,
    );
  });

  it('update: ausente continua ausente (mantém o valor atual)', () => {
    const parsed = updateMaterialSchema.parse({ type: 'text', id: LESSON, body: 'x' });
    expect(parsed.showInAllLessons).toBeUndefined();
    expect(
      updateMaterialSchema.parse({
        type: 'link',
        id: LESSON,
        title: 't',
        url: 'https://a.dev',
        showInAllLessons: false,
      }).showInAllLessons,
    ).toBe(false);
  });
});

describe('updateMaterialSchema', () => {
  it('vídeo sem URL mantém o vídeo; arquivo sem file mantém o arquivo', () => {
    expect(updateMaterialSchema.safeParse({ type: 'video', id: LESSON, title: 'x' }).success).toBe(
      true,
    );
    expect(updateMaterialSchema.safeParse({ type: 'file', id: LESSON, title: 'x' }).success).toBe(
      true,
    );
    expect(
      updateMaterialSchema.safeParse({ type: 'video', id: LESSON, url: 'https://evil.com' })
        .success,
    ).toBe(false);
  });
});
