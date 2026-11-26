import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchCity } from '../src/ingest/city.js';

describe('matchCity', () => {
  const cases: Array<{ text: string; display: string; key: string }> = [
    { text: 'Сдам квартиру в Подгорице', display: 'Podgorica', key: 'podgorica' },
    { text: 'Stan u Podgorici, centar', display: 'Podgorica', key: 'podgorica' },
    { text: 'Подгорицу сдам', display: 'Podgorica', key: 'podgorica' },
    { text: 'Квартира в Никшићу', display: 'Nikšić', key: 'niksic' },
    { text: 'Квартира у Nikšiću', display: 'Nikšić', key: 'niksic' },
    { text: 'Дом в Херцег Новом', display: 'Herceg Novi', key: 'herceg-novi' },
    { text: 'Apartman, Herceg Novi', display: 'Herceg Novi', key: 'herceg-novi' },
    { text: 'Комната в Баре', display: 'Bar', key: 'bar' },
    { text: 'Soba u Baru', display: 'Bar', key: 'bar' },
    { text: 'Квартира в Будве', display: 'Budva', key: 'budva' },
    { text: 'Stan na Budvi', display: 'Budva', key: 'budva' },
    { text: 'Котор, старый город', display: 'Kotor', key: 'kotor' },
    { text: 'Тиват рядом с аэропортом', display: 'Tivat', key: 'tivat' },
    { text: 'Улцињ, центр', display: 'Ulcinj', key: 'ulcinj' },
    { text: 'Цетиње', display: 'Cetinje', key: 'cetinje' },
    { text: 'Бијело Поље', display: 'Bijelo Polje', key: 'bijelo-polje' },
    { text: 'Беране', display: 'Berane', key: 'berane' },
    { text: 'Пљевља', display: 'Pljevlja', key: 'pljevlja' },
    { text: 'Даниловград', display: 'Danilovgrad', key: 'danilovgrad' },
    { text: 'Рожаје', display: 'Rožaje', key: 'rozaje' },
    { text: 'Жабљак', display: 'Žabljak', key: 'zabljak' },
    { text: 'Плужине', display: 'Plužine', key: 'pluzine' },
    { text: 'Мојковац', display: 'Mojkovac', key: 'mojkovac' },
    { text: 'Колашин', display: 'Kolašin', key: 'kolasin' },
    { text: 'Андријевица', display: 'Andrijevica', key: 'andrijevica' },
    { text: 'Петњица', display: 'Petnjica', key: 'petnjica' },
    { text: 'Гусиње', display: 'Gusinje', key: 'gusinje' },
    { text: 'Плав', display: 'Plav', key: 'plav' },
    { text: 'Тузи', display: 'Tuzi', key: 'tuzi' },
    { text: 'Сутоморе', display: 'Sutomore', key: 'sutomore' },
    { text: 'Петровац на мору', display: 'Petrovac', key: 'petrovac' },
    { text: 'Игало', display: 'Igalo', key: 'igalo' },
    { text: 'Бечићи', display: 'Bečići', key: 'becici' },
    { text: 'Шавник', display: 'Šavnik', key: 'savnik' },
  ];

  for (const testCase of cases) {
    it(`finds ${testCase.display} in ${JSON.stringify(testCase.text)}`, () => {
      assert.deepEqual(matchCity(testCase.text), {
        display: testCase.display,
        key: testCase.key,
      });
    });
  }

  it('returns null for an unknown or foreign city', () => {
    assert.equal(matchCity('Сдам квартиру в Белграде'), null);
    assert.equal(matchCity('Продам телефон'), null);
    assert.equal(matchCity(''), null);
  });

  it('does not match a short city name inside a longer word', () => {
    assert.equal(matchCity('baraholka_Monte'), null);
    assert.equal(matchCity('продам плавающий матрас'), null);
  });

  it('returns the earliest match when several cities appear', () => {
    assert.equal(matchCity('Из Бара в Подгорицу каждый день')?.key, 'bar');
    assert.equal(matchCity('Из Подгорицы в Бар')?.key, 'podgorica');
  });
});
