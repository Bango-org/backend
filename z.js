const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { ECPairFactory } = require('ecpair');
const { Buffer } = require("buffer");
const { payments } = require('bitcoinjs-lib');

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet; // Use bitcoin.networks.testnet for testnet


async function getUtxo(address) {

    const resp = await fetch(`https://mempool.space/testnet4/api/address/${address}/utxo`)
    const utxos = await resp.json()
    return utxos

}

function toXOnly(pubkey) {
    return pubkey.subarray(1, 33)
}


// function tweakSigner(signer, opts = {}) {
//     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//     // @ts-ignore
//     let privateKey = signer.privateKey;
//     if (!privateKey) {
//         throw new Error('Private key is required for tweaking signer!');
//     }
//     if (signer.publicKey[0] === 3) {
//         privateKey = tinysecp.privateNegate(privateKey);
//     }

//     const tweakedPrivateKey = tinysecp.privateAdd(
//         privateKey,
//         tapTweakHash(toXOnly(signer.publicKey), opts.tweakHash),
//     );
//     if (!tweakedPrivateKey) {
//         throw new Error('Invalid tweaked private key!');
//     }

//     return ECPair.fromPrivateKey(Buffer.from(tweakedPrivateKey), {
//         network: opts.network,
//     });
// }

function string_to_privkey(priv_key) {
    // Generate a random keypair
    const priv_key_arr = priv_key.split(",")
    const privateKeyBuffer = Buffer.from(priv_key_arr, 'hex');
    const keypair = ECPair.fromPrivateKey(privateKeyBuffer);
    const privateKey = keypair.privateKey.toString("hex")
    const pubKey = Buffer.from(keypair.publicKey.slice(33));
    const   = toXOnly(keyData.publicKey);

    const { address } = bitcoin.payments.p2tr({
        internalPubkey: pubKey,
        network: network
    });

    console.log(address)
    return {
        privateKey: privateKey,
        publicKey: pubKey,
        address: address,
        keypair: keypair
    };
}

async function createBitcoinTransaction(
    keyData,
    recipientAddress,
    amountInBTC,
    utxos,
    feeRate = 10 // satoshis per byte
) {
    // try {

    const keypair = keyData.keypair;

    const childNodeXOnlyPubkey = toXOnly(keyData.publicKey);
    const tweakedChildNode = keypair.tweak(
        bitcoin.crypto.taggedHash('TapTweak', childNodeXOnlyPubkey),
    );

    // Create Taproot payment object
    const p2tr = bitcoin.payments.p2tr({
        internalPubkey: childNodeXOnlyPubkey,
        network
    });

    // Initialize PSBT
    const psbt = new bitcoin.Psbt({ network });

    // Calculate total input amount from UTXOs
    const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

    // Add inputs from UTXOs
    utxos.forEach(utxo => {
        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
                script: p2tr.output,
                value: utxo.value,
            },
            tapInternalKey: keyData.publicKey
        });
    });


    // Convert BTC to satoshis
    const amountInSatoshis = Math.floor(amountInBTC * 100000000);

    // Add recipient output
    psbt.addOutput({
        address: recipientAddress,
        value: amountInSatoshis
    });

    // Estimate fee
    const estimatedSize = utxos.length * 160 + 2 * 34 + 10;
    const fee = estimatedSize * feeRate;

    // Calculate change amount
    const changeAmount = totalInput - amountInSatoshis - fee;

    if (changeAmount < 0) {
        throw new Error('Insufficient funds including fee');
    }

    // Add change output if necessary (dust threshold = 546 satoshis)
    if (changeAmount > 546) {
        psbt.addOutput({
            address: p2tr.address,
            value: changeAmount
        });
    }
    console.log("========")


    // Sign all inputs
    for (let i = 0; i < utxos.length; i++) {
        psbt.signInput(i, tweakedChildNode);
    }
    console.log("========")

    // Finalize and build transaction
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    console.log("========")

    return {
        txHex: tx.toHex(),
        txId: tx.getId(),
        fee: fee,
        changeAmount: changeAmount
    };

    // } catch (error) {
    //     throw new Error(`Failed to create transaction: ${error.message}`);
    // }
}


async function main() {


    const priv_key_hex = process.env.PRIV_KEY
    const keypair = string_to_privkey(priv_key_hex);

    const utxos = await getUtxo(keypair.address);

    // Create transaction
    createBitcoinTransaction(
        keypair,
        'tb1pujtr5n8ys2t6eavyx7r26l4d07pynkj6dyh95j65uqe0wugk9t2quget8w', // Example recipient address
        0.0001, // Amount in BTC
        utxos
    )
        .then(rawTx => console.log('Raw transaction:', rawTx))
        .catch(error => console.error('Error:', error));

}

main()