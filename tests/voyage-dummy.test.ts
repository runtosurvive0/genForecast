import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditOriginLabel,
  dummyFieldKeys,
  dummyRowTitle,
  isDummyRow,
  isFieldDummy,
  parseAuditRow,
  visibleFields,
} from '../src/features/vessels/voyage-dummy.ts';

const fields = [
  { key: 'cargo_no' },
  { key: 'coal_name' },
  { key: 'cv' },
  { key: 'sulfur_pct' },
  { key: 'received_t' },
  { key: 'data_origin', system: true },
  { key: 'dummy_fields', system: true },
];

test('행 배지는 data_origin이 dummy 또는 mixed일 때만 붙는다', () => {
  assert.equal(isDummyRow({ data_origin: 'dummy' }), true);
  assert.equal(isDummyRow({ data_origin: 'mixed' }), true);
  assert.equal(isDummyRow({ data_origin: 'entered' }), false);
  assert.equal(isDummyRow({ data_origin: null }), false);
  assert.equal(isDummyRow({}), false);
});

test('행 배지 툴팁은 dummy면 생성 자료, mixed면 일부 칸 더미로 구분한다', () => {
  assert.equal(dummyRowTitle({ data_origin: 'dummy' }), '더미 자료(공개 일반값으로 생성)');
  assert.equal(dummyRowTitle({ data_origin: 'mixed', dummy_fields: 'cv' }), '일부 칸을 더미로 채움');
});

test('dummy 행은 키 칸과 system 칸을 뺀 값 있는 모든 칸이 더미다', () => {
  const row = { cargo_no: 'C-1', coal_name: 'A', cv: 6000, sulfur_pct: null, received_t: 0, data_origin: 'dummy', dummy_fields: null };
  assert.deepEqual([...dummyFieldKeys(row, fields, 'cargo_no')].sort(), ['coal_name', 'cv', 'received_t']);
});

test('dummy 행에서 빈 문자열 칸은 더미로 보지 않는다', () => {
  const row = { cargo_no: 'C-1', coal_name: '', cv: 6000, data_origin: 'dummy' };
  assert.deepEqual([...dummyFieldKeys(row, fields, 'cargo_no')], ['cv']);
});

test('mixed 행은 dummy_fields 쉼표 목록의 칸만 더미다', () => {
  const row = { cargo_no: 'C-1', cv: 6000, sulfur_pct: 0.5, received_t: 50000, data_origin: 'mixed', dummy_fields: ' cv, sulfur_pct ,' };
  const keys = dummyFieldKeys(row, fields, 'cargo_no');
  assert.deepEqual([...keys].sort(), ['cv', 'sulfur_pct']);
  assert.equal(isFieldDummy(row, fields, 'cargo_no', 'cv'), true);
  assert.equal(isFieldDummy(row, fields, 'cargo_no', 'received_t'), false);
});

test('entered 행이나 dummy_fields가 비면 더미 칸이 없다', () => {
  assert.equal(dummyFieldKeys({ cv: 1, data_origin: 'entered', dummy_fields: 'cv' }, fields, 'cargo_no').size, 0);
  assert.equal(dummyFieldKeys({ cv: 1, data_origin: 'mixed', dummy_fields: null }, fields, 'cargo_no').size, 0);
});

test('편집·상세 칸 목록에서 system 칸을 모두 거른다', () => {
  assert.deepEqual(visibleFields(fields).map((f) => f.key), ['cargo_no', 'coal_name', 'cv', 'sulfur_pct', 'received_t']);
});

test('변경 이력 출처는 엑셀·더미 적재·직접 입력으로 표시한다', () => {
  assert.equal(auditOriginLabel('excel'), '엑셀');
  assert.equal(auditOriginLabel('dummy-data'), '더미 적재');
  assert.equal(auditOriginLabel('manual'), '직접 입력');
});

test('변경 이력의 삭제 기록(null)은 예외 없이 빈 행으로 읽는다', () => {
  assert.equal(parseAuditRow('null'), null);
  assert.equal(parseAuditRow(null), null);
  assert.equal(parseAuditRow('not json'), null);
  assert.deepEqual(parseAuditRow('{"cv":6000}'), { cv: 6000 });
});
