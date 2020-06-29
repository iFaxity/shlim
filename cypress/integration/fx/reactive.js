/// <reference types="cypress" />
import { reactive, ref, toReactive, isReactive, toRaw } from '@kirei/fx';

describe('@ifaxity/fx/reactive', () => {
  describe('#isReactive()', () => {
    it('with reactive', () => {
      const r = reactive({});
      assert(isReactive(r));
    });
    it('with Proxy', () => {
      assert(!isReactive(new Proxy({}, {})))
    });
    it('with object', () => assert(!isReactive({})));
    it('with null', () => assert(!isReactive(null)));
    it('with undefined', () => assert(!isReactive()));
  });

  describe('#toReactive()', () => {
    it('with reactive', () => {
      const r = reactive({});
      assert.equal(toReactive(r), r);
    });
    it('with object', () => assert(isReactive(toReactive({}))));
    it('with null', () => assert.equal(toReactive(null), null));
    it('with undefined', () => assert.equal(toReactive(), undefined));
    it('with primitive', () => assert.equal(toReactive(10), 10));
  });

  describe('#toRaw()', () => {
    it('with reactive', () => {
      const o = {};
      const r = reactive(o);
      assert.equal(toRaw(r), o)
    });
    it('with Proxy', () => {
      const p = new Proxy({}, {});
      assert.equal(toRaw(p), p)
    });
    it('with primitive', () => {
      assert.equal(toRaw('hi'), 'hi');
    });
    it('with null', () => {
      assert.equal(toRaw(null), null);
    });
    it('with undefined', () => {
      assert.equal(toRaw(), undefined);
    });
  });

  // only test read and writes on some props
  describe('#readonly()', () => {});

  describe('#reactive()', () => {
    it('with object', () => {
      const r = reactive({});
      const a = reactive([]);
      assert(isReactive(r));
      assert(isReactive(a));
    });
    it('prevent reactive cloning', () => {
      const r = reactive({});
      assert.equal(r, reactive(r));
    });
    it('check caching', () => {
      const t = {};
      const r = reactive(t);
      assert.equal(r, reactive(t));
    });
    it('with primitives', () => {
      assert.throws(() => reactive('hi'));
      assert.throws(() => reactive(100));
      assert.throws(() => reactive(false));
      assert.throws(() => reactive(Symbol()));
    });

    describe('with object', () => {
      let baz, o, r;
      beforeEach(() => {
        baz = ref('hi');
        o = { foo: 'bar', baz };
        r = reactive(o);
      });

      it('get', () => {
        assert.equal(r.foo, 'bar');
        // Check ref unwrapping
        assert.equal(r.baz, 'hi');
      });
      it('set', () => {
        r.foo = 'fooz';
        assert.equal(r.foo, 'fooz');

        assert.notEqual(r.bar, 10);
        r.bar = 10;
        assert.equal(r.bar, 10);

        // check ref swapping & updating
        r.baz = -1;
        assert.equal(baz.value, -1);

        r.baz = ref('zab');
        assert.equal(r.baz, 'zab');
      });
      it('delete', () => {
        r.greeting = 'Hello there';
        assert.equal(r.greeting, 'Hello there');

        delete r.greeting;
        assert.equal(typeof r.greeting, 'undefined');
      });
      it('has', () => {
        assert('foo' in r);
        assert.equal('FOO' in r, false);
      });
      it('ownKeys', () => {
        const keys = Object.keys(r);
        assert.deepEqual(keys, [ 'foo', 'baz' ]);
      });
    });

    describe('with array', () => {
      let baz, a, r;
      beforeEach(() => {
        baz = ref('hi');
        a = [ 'first', 'second', 'first', baz ];
        r = reactive(a);
      });

      // Test shims
      describe('search shims', () => {
        it('#indexOf()', () => {
          assert.equal(a.indexOf('second'), 1);
          assert.equal(a.indexOf('third'), -1);
        });
        it('#lastIndexOf()', () => {
          assert.equal(a.lastIndexOf('first'), 2);
          assert.equal(a.lastIndexOf('fifth'), -1);
        });
        it('#includes()', () => {
          assert(a.includes('first'));
          assert(!a.includes('fourth'));
        });
      });

      it('get', () => {
        assert.equal(r[0], 'first');
        // Check ref not unwrapping
        assert.equal(r[3], baz);
      });
      it('set', () => {
        r[2] = 'third';
        assert.equal(r[2], 'third');

        assert.notEqual(r[4], 10);
        r[4] = 10;
        assert.equal(r[4], 10);

        // ref should not swap like object
        r[3] = -1;
        assert.equal(baz.value, 'hi');
        assert.equal(r[3], -1);
      });
      it('delete', () => {
        r[5] = 'Hello there';
        assert.equal(r[5], 'Hello there');

        delete r[5];
        assert.equal(r[5], undefined);
      });
      it('has', () => {
        assert('1' in r);
        assert.equal('FOO' in r, false);
      });
      it('ownKeys', () => {
        const keys = Object.keys(r);
        assert.deepEqual(keys, [ '0', '1', '2', '3' ]);
      });
    });

    describe('with Map', () => {
      let baz, m, r;
      beforeEach(() => {
        baz = ref('hi');
        m = new Map([ ['foo', 'bar'], ['baz', baz] ]);
        r = reactive(m);
      });

      it('get', () => {
        assert.equal(r.get('foo'), 'bar');
        // Check ref unwrapping
        assert.equal(r.get('baz'), 'hi');
      });
      it('set', () => {
        r.set('foo', 'fooz');
        assert.equal(r.get('foo'), 'fooz');

        assert.notEqual(r.get('bar'), 10);
        r.set('bar', 10);
        assert.equal(r.get('bar'), 10);

        // ref should swap, but not update
        r.set('baz', -1);
        assert.notEqual(baz.value, -1);

        r.set('baz', ref('zab'));
        assert.equal(r.get('baz'), 'zab');
      });
      it('has', () => {
        assert.ok(r.has('foo'));
        assert.ok(!r.has('bar'));
      });
      it('delete', () => {
        r.set('greeting', 'Hello there');
        assert.equal(r.get('greeting'), 'Hello there');

        r.delete('greeting');
        assert.equal(typeof r.get('greeting'), 'undefined');
      });
      it('clear', () => {
        assert.equal(r.size, 2);
        r.clear();
        assert.equal(r.size, 0);
      });
      it('forEach', () => {
        r.forEach((value, key) => {
          assert.equal(value, m.get(key));
        });
      });
      // test keys, values, entries
    });

    describe('with Set', () => {
      let s, r;
      beforeEach(() => {
        s = new Set([ 'first', 'second']);
        r = reactive(s);
      });

      it('add', () => {
        assert(!s.has('third'));
        r.add('third');
        assert(s.has('third'));
      });
      it('has', () => {
        assert(!r.has('hello'));
        s.add('hello');
        assert(r.has('hello'));
      });
      it('delete', () => {
        assert(s.has('first'));
        r.delete('first');
        assert(!s.has('first'));
      });
      it('clear', () => {
        assert.equal(s.size, 2);
        r.clear();
        assert.equal(s.size, 0);
      });
      it('forEach', () => {
        r.forEach(item => assert(s.has(item)));
      });

      // test keys, values, entries, and Symbol.iterator
    });
  });
})
