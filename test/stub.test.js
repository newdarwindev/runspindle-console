import test from 'node:test';
import assert from 'node:assert/strict';
import {readiness} from '../src/status.js';
test('unimplemented state remains explicit',()=>assert.equal(readiness().state,'not_implemented'));
