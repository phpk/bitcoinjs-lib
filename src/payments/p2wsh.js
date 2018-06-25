let lazy = require('./lazy')
let typef = require('typeforce')
let OPS = require('bitcoin-ops')

let baddress = require('../address')
let bcrypto = require('../crypto')
let bscript = require('../script')
let BITCOIN_NETWORK = require('../networks').bitcoin

let EMPTY_BUFFER = Buffer.alloc(0)

function stacksEqual (a, b) {
  if (a.length !== b.length) return false

  return a.every(function (x, i) {
    return x.equals(b[i])
  })
}

// input: <>
// witness: [redeemScriptSig ...] {redeemScript}
// output: OP_0 {sha256(redeemScript)}
function p2wsh (a, opts) {
  if (
    !a.address &&
    !a.hash &&
    !a.output &&
    !a.redeem &&
    !a.witness
  ) throw new TypeError('Not enough data')
  opts = opts || { validate: true }

  typef({
    network: typef.maybe(typef.Object),

    address: typef.maybe(typef.String),
    hash: typef.maybe(typef.BufferN(32)),
    output: typef.maybe(typef.BufferN(34)),

    redeem: typef.maybe({
      input: typef.maybe(typef.Buffer),
      network: typef.maybe(typef.Object),
      output: typef.Buffer,
      witness: typef.maybe(typef.arrayOf(typef.Buffer))
    }),
    input: typef.maybe(typef.BufferN(0)),
    witness: typef.maybe(typef.arrayOf(typef.Buffer))
  }, a)

  let _address = lazy.value(function () { return baddress.fromBech32(a.address) })
  let _rchunks = lazy.value(function () { return bscript.decompile(a.redeem.input) })

  let network = a.network || BITCOIN_NETWORK
  let o = { network }

  lazy.prop(o, 'address', function () {
    if (!o.hash) return
    return baddress.toBech32(o.hash, 0x00, network.bech32)
  })
  lazy.prop(o, 'hash', function () {
    if (a.output) return a.output.slice(2)
    if (a.address) return baddress.fromBech32(a.address).data
    if (o.redeem && o.redeem.output) return bcrypto.sha256(o.redeem.output)
  })
  lazy.prop(o, 'output', function () {
    if (!o.hash) return
    return bscript.compile([
      OPS.OP_0,
      o.hash
    ])
  })
  lazy.prop(o, 'redeem', function () {
    if (!a.witness) return
    return {
      output: a.witness[a.witness.length - 1],
      input: EMPTY_BUFFER,
      witness: a.witness.slice(0, -1)
    }
  })
  lazy.prop(o, 'input', function () {
    if (!o.witness) return
    return EMPTY_BUFFER
  })
  lazy.prop(o, 'witness', function () {
    // transform redeem input to witness stack?
    if (a.redeem && a.redeem.input && a.redeem.input.length > 0) {
      let stack = bscript.toStack(_rchunks())

      // assign, and blank the existing input
      o.redeem = Object.assign({ witness: stack }, a.redeem)
      o.redeem.input = EMPTY_BUFFER
      return [].concat(stack, a.redeem.output)
    }

    if (!a.redeem) return
    if (!a.redeem.witness) return
    return [].concat(a.redeem.witness, a.redeem.output)
  })

  // extended validation
  if (opts.validate) {
    let hash
    if (a.address) {
      if (_address().prefix !== network.bech32) throw new TypeError('Network mismatch')
      if (_address().version !== 0x00) throw new TypeError('Invalid version')
      if (_address().data.length !== 32) throw new TypeError('Invalid data')
      else hash = _address().data
    }

    if (a.hash) {
      if (hash && !hash.equals(a.hash)) throw new TypeError('Hash mismatch')
      else hash = a.hash
    }

    if (a.output) {
      if (
        a.output.length !== 34 ||
        a.output[0] !== OPS.OP_0 ||
        a.output[1] !== 0x20) throw new TypeError('Output is invalid')
      let hash2 = a.output.slice(2)
      if (hash && !hash.equals(hash2)) throw new TypeError('Hash mismatch')
      else hash = hash2
    }

    if (a.redeem) {
      if (a.redeem.network && a.redeem.network !== network) throw new TypeError('Network mismatch')

      // is there two redeem sources?
      if (
        a.redeem.input &&
        a.redeem.input.length > 0 &&
        a.redeem.witness) throw new TypeError('Ambiguous witness source')

      // is the redeem output non-empty?
      if (bscript.decompile(a.redeem.output).length === 0) throw new TypeError('Redeem.output is invalid')

      // match hash against other sources
      let hash2 = bcrypto.sha256(a.redeem.output)
      if (hash && !hash.equals(hash2)) throw new TypeError('Hash mismatch')
      else hash = hash2

      if (a.redeem.input && !bscript.isPushOnly(_rchunks())) throw new TypeError('Non push-only scriptSig')
      if (a.witness && a.redeem.witness && !stacksEqual(a.witness, a.redeem.witness)) throw new TypeError('Witness and redeem.witness mismatch')
    }

    if (a.witness) {
      if (a.redeem && !a.redeem.output.equals(a.witness[a.witness.length - 1])) throw new TypeError('Witness and redeem.output mismatch')
    }
  }

  return Object.assign(o, a)
}

module.exports = p2wsh
