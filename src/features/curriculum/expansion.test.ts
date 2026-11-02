import { describe, expect, it } from 'vitest';

import { parseLessonParam, toggleLesson, withOpenLesson } from './expansion';

const ID = '3f2b8c1e-5a47-4d9e-8b1a-0c6d2e7f9a10';

describe('parseLessonParam', () => {
  it('aceita uuid, usa o primeiro de uma lista e rejeita o resto', () => {
    expect(parseLessonParam(ID)).toBe(ID);
    expect(parseLessonParam([ID, 'x'])).toBe(ID);
    expect(parseLessonParam('nao-e-uuid')).toBeNull();
    expect(parseLessonParam('')).toBeNull();
    expect(parseLessonParam(undefined)).toBeNull();
  });
});

describe('withOpenLesson', () => {
  it('abre a aula e fixa a aba da ementa', () => {
    expect(withOpenLesson('', ID)).toBe(`?tab=syllabus&aula=${ID}`);
  });
  it('troca a aula aberta e preserva outros parâmetros', () => {
    expect(withOpenLesson(`?tab=syllabus&aula=old&x=1`, ID)).toBe(`?tab=syllabus&aula=${ID}&x=1`);
  });
  it('fecha removendo apenas o parâmetro da aula', () => {
    expect(withOpenLesson(`?tab=syllabus&aula=${ID}`, null)).toBe('?tab=syllabus');
  });
});

describe('toggleLesson', () => {
  it('abre uma por vez e fecha ao repetir', () => {
    expect(toggleLesson(null, 'a')).toBe('a');
    expect(toggleLesson('a', 'b')).toBe('b');
    expect(toggleLesson('b', 'b')).toBeNull();
  });
});
