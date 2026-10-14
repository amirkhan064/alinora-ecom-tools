const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSortMode } = require('../services/label-processor.service');

test('sort-only mode disables cropping even when passed as a string flag', () => {
  assert.deepEqual(resolveSortMode({ sortOnly: 'true' }), {
    skipCropping: true,
    shouldCrop: false,
  });

  assert.deepEqual(resolveSortMode({ skipCropping: 'TRUE' }), {
    skipCropping: true,
    shouldCrop: false,
  });

  assert.deepEqual(resolveSortMode({ sortOnly: 'false' }), {
    skipCropping: false,
    shouldCrop: true,
  });
});
