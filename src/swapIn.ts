import { Transaction, VersionedTransaction, sendAndConfirmTransaction, Connection, Keypair, TransactionExpiredBlockheightExceededError, ComputeBudgetProgram, TransactionMessage } from '@solana/web3.js'
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import axios from 'axios'
import dotenv from 'dotenv'
import { API_URLS, parseTokenAccountResp } from '@raydium-io/raydium-sdk-v2'
import { Wallet } from '@coral-xyz/anchor'
import bs58 from 'bs58'

dotenv.config()

interface SwapCompute {
    id: string
    success: true
    version: 'V0' | 'V1'
    openTime?: undefined
    msg: undefined
    data: {
        swapType: 'BaseIn' | 'BaseOut'
        inputMint: string
        inputAmount: string
        outputMint: string
        outputAmount: string
        otherAmountThreshold: string
        slippageBps: number
        priceImpactPct: number
        routePlan: {
            poolId: string
            inputMint: string
            outputMint: string
            feeMint: string
            feeRate: number
            feeAmount: string
        }[]
    }
}

async function fetchTokenAccountData(connection: Connection, owner: Wallet) {
    const solAccountResp = await connection.getAccountInfo(owner.publicKey)
    const tokenAccountResp = await connection.getTokenAccountsByOwner(owner.publicKey, { programId: TOKEN_PROGRAM_ID })
    // const token2022Req = await connection.getTokenAccountsByOwner(owner.publicKey, { programId: TOKEN_2022_PROGRAM_ID })
    const tokenAccountData = parseTokenAccountResp({
        owner: owner.publicKey,
        solAccountResp,
        tokenAccountResp: {
            context: tokenAccountResp.context,
            // value: [...tokenAccountResp.value, ...token2022Req.value],
            value: [...tokenAccountResp.value],
        },
    })
    return tokenAccountData
}

export const apiSwap = async (inputMint: string, outputMint: string, amount: number, slippage: number, txVersion: string) => {


    console.log("RPC_URL", process.env.RPC_URL)
    let connection = new Connection(process.env.RPC_URL);
    let owner = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(process.env.WALLET_PRIVATE_KEY)));

    // const inputMint = NATIVE_MINT.toBase58()
    // const outputMint = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' // RAY
    // const amount = 10000
    // const slippage = 0.5 // in percent, for this example, 0.5 means 0.5%
    // const txVersion: string = 'V0' // or LEGACY

    const isV0Tx = txVersion === 'V0'

    let [isInputSol, isOutputSol] = [inputMint === NATIVE_MINT.toBase58(), outputMint === NATIVE_MINT.toBase58()]
    // isInputSol = false; // In order to remove wrapping sol tx
    // isOutputSol = false; // In order to remove unwrapping sol tx

    const { tokenAccounts } = await fetchTokenAccountData(connection, new Wallet(owner))
    const inputTokenAcc = tokenAccounts.find((a) => a.mint.toBase58() === inputMint)?.publicKey
    const outputTokenAcc = tokenAccounts.find((a) => a.mint.toBase58() === outputMint)?.publicKey

    console.log("inputTokenAcc: ", inputTokenAcc?.toBase58())
    console.log("outputTokenAcc: ", outputTokenAcc?.toBase58())

    if (!inputTokenAcc && !isInputSol) {
        console.error('do not have input token account')
        return
    }

    // get statistical transaction fee from api
    /**
     * vh: very high
     * h: high
     * m: medium
     */
    const { data } = await axios.get<{
        id: string
        success: boolean
        data: { default: { vh: number; h: number; m: number } }
    }>(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`)

    // // renamed data to swapResponse
    const { data: swapResponse } = await axios.get<SwapCompute>(
        `${API_URLS.SWAP_HOST
        }/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100
        }&txVersion=${txVersion}`
    )

    console.log("swapResponse: ", swapResponse)

    const { data: swapTransactions } = await axios.post<{
        id: string
        version: string
        success: boolean
        data: { transaction: string }[]
    }>(`${API_URLS.SWAP_HOST}/transaction/swap-base-in`, {
        computeUnitPriceMicroLamports: String(data.data.default.h),
        swapResponse,
        txVersion,
        wallet: owner.publicKey.toBase58(),
        wrapSol: false, //isInputSol,
        unwrapSol: false, //isOutputSol, // true means output mint receive sol, false means output mint received wsol
        // inputAccount: isInputSol ? undefined : inputTokenAcc?.toBase58(),
        inputAccount: inputTokenAcc ? inputTokenAcc?.toBase58() : undefined,
        outputAccount: isOutputSol ? undefined : outputTokenAcc?.toBase58(),
    })


    console.log("swapTransactions.data: ", swapTransactions.data)

    // // append priority fee to the transaction
    let priorityFee = 0.001 * 10 ** 9 // lamports

    // // append priority fee to the tx
    let budgetIxs = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 183_504 }),
    ]

    const recentBlockhash = await connection.getLatestBlockhash({
        commitment: 'confirmed',
    })
    // Create a TransactionMessage
    const transactionMessage = new TransactionMessage({
        payerKey: owner.publicKey, // Replace with the actual payer's public key
        instructions: [...budgetIxs],
        recentBlockhash: recentBlockhash.blockhash, // Replace with the actual recent blockhash
    });

    // Compile the message to a versioned message
    const versionedMessage = transactionMessage.compileToV0Message();

    // Create a VersionedTransaction
    const versionedTransactionForBudgetIxs = new VersionedTransaction(versionedMessage);

    const allTxBuf = swapTransactions.data.map((tx) =>
        Buffer.from(tx.transaction, 'base64')
    )
    const allTransactions = [
        // versionedTransactionForBudgetIxs,
        ...allTxBuf.map((txBuf) =>
            isV0Tx ? VersionedTransaction.deserialize(txBuf) : Transaction.from(txBuf)
        )]

    console.log(`total ${allTransactions.length} transactions`, swapTransactions)

    let idx = 0
    if (!isV0Tx) {
        for (const tx of allTransactions) {
            console.log(`${++idx} transaction sending...`)
            const transaction = tx as Transaction
            transaction.sign(owner)
            const txId = await sendAndConfirmTransaction(connection, transaction, [owner], { skipPreflight: true })
            console.log(`${++idx} transaction confirmed, txId: ${txId}, solscan: https://solscan.io/tx/${txId}`)

            console.log(`${++idx} transaction: ${transaction.serialize().toString('base64')}`)

        }
    } else {
        for (const tx of allTransactions) {
            idx++
            const transaction = tx as VersionedTransaction
            transaction.sign([owner]);


            // simulate transaction
            const simRes = await connection.simulateTransaction(transaction, {
                commitment: 'confirmed',
                sigVerify: true,
            })
            console.log(`${idx} transaction simulation result:`, simRes.value)
            console.log(`${idx} transaction simulation result: ${simRes.value.err}`)

            // send transaction

            let txId = ""
            try {
                txId = await connection.sendTransaction(tx as VersionedTransaction, { skipPreflight: true })
                const { lastValidBlockHeight, blockhash } = await connection.getLatestBlockhash({
                    commitment: 'finalized',
                })
                console.log(`${idx} transaction sending..., txId: ${txId}, solscan: https://solscan.io/tx/${txId}`)
                await connection.confirmTransaction(
                    {
                        blockhash,
                        lastValidBlockHeight,
                        signature: txId,
                    },
                    'confirmed'
                )
                console.log(`${idx} transaction confirmed, solscan: https://solscan.io/tx/${txId}`)
            } catch (error) {
                if (error instanceof TransactionExpiredBlockheightExceededError) {
                    console.error("TransactionExpiredBlockheightExceededError: Blockheight exceeded by 150 blocks since the transaction was sent")
                    console.error(`you may not find the tx in solscan: https://solscan.io/tx/${txId}`)
                }
                console.log("error", error)

            }
        }
    }
}


// 1_000_000_000 lamports
// apiSwap(NATIVE_MINT.toBase58(), '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', 10000, 5, 'V0')
// // 0.009018888 // expect      | 
// // 0.000901500 // providing   | 901500
// // 0.001803 // actual balance | 1803

// 1000_000_00 // 1 SOL
// apiSwap('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112', 1803, 5, 'V0')
apiSwap('So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 100000, 5, 'V0')