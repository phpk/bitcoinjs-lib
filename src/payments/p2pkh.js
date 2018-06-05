let lazy = require('./lazy')
let typef = require('typeforce')
let OPS = require('bitcoin-ops')
let ecc = require('tiny-secp256k1')

let baddress = require('../address')
let bcrypto = require('../crypto')
let bscript = require('../script')
let BITCOIN_NETWORK = require('../networks').bitcoin

// input: {signature} {pubkey}
// output: OP_DUP OP_HASH160 {hash160(pubkey)} OP_EQUALVERIFY OP_CHECKSIG
function p2pkh (a, opts) {
  if (
    !a.address &&
    !a.hash &&
    !a.output &&
    !a.pubkey &&
    !a.input
  ) throw new TypeError('Not enough data')
  opts = opts || { validate: true }

  typef({
    network: typef.maybe(typef.Object),
    address: typef.maybe(typef.String),
    hash: typef.maybe(typef.BufferN(20)),
    output: typef.maybe(typef.BufferN(25)),

    pubkey: typef.maybe(ecc.isPoint),
    signature: typef.maybe(bscript.isCanonicalScriptSignature),
    input: typef.maybe(typef.Buffer)
  }, a)

  let _address = lazy.value(function () { return baddress.fromBase58Check(a.address) })
  let _chunks = lazy.value(function () { return bscript.decompile(a.input) })

  let network = a.network || BITCOIN_NETWORK
  let o = { network }

  lazy.prop(o, 'address', function () {
    if (!o.hash) return
    return baddress.toBase58Check(o.hash, network.pubKeyHash)
  })
  lazy.prop(o, 'hash', function () {
    if (a.output) return a.output.slice(3, 23)
    if (a.address) return _address().hash
    if (a.pubkey || o.pubkey) return bcrypto.hash160(a.pubkey || o.pubkey)
  })
  lazy.prop(o, 'output', function () {
    if (!o.hash) return
    return bscript.compile([
      OPS.OP_DUP,
      OPS.OP_HASH160,
      o.hash,
      OPS.OP_EQUALVERIFY,
      OPS.OP_CHECKSIG
    ])
  })
  lazy.prop(o, 'pubkey', function () {
    if (!a.input) return
    return _chunks()[1]
  })
  lazy.prop(o, 'signature', function () {
    if (!a.input) return
    return _chunks()[0]
  })
  lazy.prop(o, 'input', function () {
    if (!a.pubkey) return
    if (!a.signature) return
    return bscript.compile([a.signature, a.pubkey])
  })
  lazy.prop(o, 'witness', function () {
    if (!o.input) return
    return []
  })

  // extended validation
  if (opts.validate) {
    let hash
    if (a.address) {
      if (_address().version !== network.pubKeyHash) throw new TypeError('Network mismatch')
      if (_address().hash.length !== 20) throw new TypeError('Invalid address')
      else hash = _address().hash
    }

    if (a.hash) {
      if (hash && !hash.equals(a.hash)) throw new TypeError('Hash mismatch')
      else hash = a.hash
    }

    if (a.output) {
      if (
        a.output.length !== 25 ||
        a.output[0] !== OPS.OP_DUP ||
        a.output[1] !== OPS.OP_HASH160 ||
        a.output[2] !== 0x14 ||
        a.output[23] !== OPS.OP_EQUALVERIFY ||
        a.output[24] !== OPS.OP_CHECKSIG) throw new TypeError('Output is invalid')

      if (hash && !hash.equals(a.output.slice(3, 23))) throw new TypeError('Hash mismatch')
      else hash = a.output.slice(3, 23)
    }

    if (a.pubkey) {
      let pkh = bcrypto.hash160(a.pubkey)
      if (hash && !hash.equals(pkh)) throw new TypeError('Hash mismatch')
      else hash = pkh
    }

    if (a.input) {
      let chunks = _chunks()
      if (chunks.length !== 2) throw new TypeError('Input is invalid')
      if (!bscript.isCanonicalScriptSignature(chunks[0])) throw new TypeError('Input has invalid signature')
      if (!ecc.isPoint(chunks[1])) throw new TypeError('Input has invalid pubkey')

      if (a.signature && !a.signature.equals(chunks[0])) throw new TypeError('Signature mismatch')
      if (a.pubkey && !a.pubkey.equals(chunks[1])) throw new TypeError('Pubkey mismatch')

      let pkh = bcrypto.hash160(chunks[1])
      if (hash && !hash.equals(pkh)) throw new TypeError('Hash mismatch')
    }
  }

  return Object.assign(o, a)
}

module.exports = p2pkh
