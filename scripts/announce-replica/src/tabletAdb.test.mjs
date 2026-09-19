// Tablet capture, part 2 — reading `adb` output. Tests written BEFORE the implementation (TDD).
//
// Pure parsers only: the real `adb` calls live in scripts/measure-announce-solo.mjs. Nothing
// here (or there) writes a setting on the device: `adb devices`, a read of /proc/net/unix and a
// temporary port forward are all the tool ever does.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseAdbDevices, chooseDevice, findWebviewSocketNames } from './tabletAdb.mjs';

const DEVICES_ONE = 'List of devices attached\n202546NMM32800870\tdevice product:M328-EEA model:M328_EEA device:M328-EEA transport_id:5\n\n';

describe('parseAdbDevices', () => {
  test('reads serial and state from `adb devices -l`', () => {
    assert.deepEqual(parseAdbDevices(DEVICES_ONE), [{ serial: '202546NMM32800870', state: 'device', model: 'M328_EEA' }]);
  });

  test('an empty list (nothing attached, as it was before the tablet was plugged in)', () => {
    assert.deepEqual(parseAdbDevices('List of devices attached\n\n'), []);
  });

  test('keeps unauthorized and offline devices, with their state', () => {
    const text = 'List of devices attached\nAAA\tunauthorized transport_id:1\nBBB\toffline transport_id:2\nCCC\tdevice transport_id:3\n';
    assert.deepEqual(parseAdbDevices(text).map((d) => [d.serial, d.state]), [['AAA', 'unauthorized'], ['BBB', 'offline'], ['CCC', 'device']]);
  });

  test('ignores adb daemon start-up chatter and Windows line endings', () => {
    const text = '* daemon not running; starting now at tcp:5037\r\n* daemon started successfully\r\nList of devices attached\r\nAAA\tdevice\r\n';
    assert.deepEqual(parseAdbDevices(text).map((d) => d.serial), ['AAA']);
  });

  test('garbage and empty input give an empty list, never a throw', () => {
    assert.deepEqual(parseAdbDevices(''), []);
    assert.deepEqual(parseAdbDevices(undefined), []);
    assert.deepEqual(parseAdbDevices('something unexpected'), []);
  });
});

describe('chooseDevice', () => {
  const one = parseAdbDevices(DEVICES_ONE);

  test('one authorised device is chosen', () => {
    assert.equal(chooseDevice(one).serial, '202546NMM32800870');
  });

  test('no devices is a clear error that says what to do, without changing anything', () => {
    assert.throws(() => chooseDevice([]), /No authorised adb device.*USB/s);
  });

  test('an unauthorised device is not chosen, and the error says to accept the prompt on the tablet', () => {
    assert.throws(() => chooseDevice([{ serial: 'AAA', state: 'unauthorized' }]), /unauthorized.*prompt/is);
  });

  test('two authorised devices are AMBIGUOUS: refuse to guess which tablet to measure', () => {
    const two = [{ serial: 'AAA', state: 'device' }, { serial: 'BBB', state: 'device' }];
    assert.throws(() => chooseDevice(two), /--serial/);
  });

  test('--serial picks one of several', () => {
    const two = [{ serial: 'AAA', state: 'device' }, { serial: 'BBB', state: 'device' }];
    assert.equal(chooseDevice(two, 'BBB').serial, 'BBB');
  });

  test('--serial for a device that is not attached is an error naming what is', () => {
    assert.throws(() => chooseDevice(one, 'ZZZ'), /ZZZ.*202546NMM32800870/s);
  });

  test('--serial for a device that is attached but not authorised is refused', () => {
    assert.throws(() => chooseDevice([{ serial: 'AAA', state: 'offline' }], 'AAA'), /offline/);
  });
});

describe('findWebviewSocketNames — is the WebView exposing DevTools?', () => {
  const HEADER = 'Num       RefCount Protocol Flags    Type St Inode Path\n';

  test('finds the abstract socket name, dropping the leading @', () => {
    const text = `${HEADER}0000000000000000: 00000002 00000000 00010000 0001 01 45678 @webview_devtools_remote_12345\n`;
    assert.deepEqual(findWebviewSocketNames(text), ['webview_devtools_remote_12345']);
  });

  test('NONE found (what the tablet reported on 2026-09-19, WebView debugging off) is an empty list', () => {
    const text = `${HEADER}0000000000000000: 00000002 00000000 00010000 0001 01 11111 @jdwp-control\n0000000000000000: 00000002 00000000 00010000 0001 01 22222 /dev/socket/zygote\n`;
    assert.deepEqual(findWebviewSocketNames(text), []);
  });

  test('several sockets are all returned, in order, so the caller can warn', () => {
    const text = `${HEADER}0: 2 0 10000 1 1 1 @webview_devtools_remote_1\n0: 2 0 10000 1 1 2 @webview_devtools_remote_2\n`;
    assert.deepEqual(findWebviewSocketNames(text), ['webview_devtools_remote_1', 'webview_devtools_remote_2']);
  });

  test('empty, missing or non-string input gives an empty list', () => {
    assert.deepEqual(findWebviewSocketNames(''), []);
    assert.deepEqual(findWebviewSocketNames(undefined), []);
    assert.deepEqual(findWebviewSocketNames(42), []);
  });

  test('a socket name is only ever the plain identifier: nothing that could reach a shell', () => {
    const text = `${HEADER}0: 2 0 10000 1 1 1 @webview_devtools_remote_1;reboot\n`;
    assert.deepEqual(findWebviewSocketNames(text), []);
  });
});
