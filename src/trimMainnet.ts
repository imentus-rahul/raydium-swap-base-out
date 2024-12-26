import fs from 'fs';
import axios from 'axios';
import JSONStream from 'JSONStream';
import { swapConfig } from './swapConfig';

interface PoolInfo {
    id: string;
    baseMint: string;
    quoteMint: string;
    lpMint: string;
    version: number;
    programId: string;
    authority: string;
    openOrders: string;
    targetOrders: string;
    baseVault: string;
    quoteVault: string;
    withdrawQueue: string;
    lpVault: string;
    marketVersion: number;
    marketProgramId: string;
    marketId: string;
    marketAuthority: string;
    marketBaseVault: string;
    marketQuoteVault: string;
    marketBids: string;
    marketAsks: string;
    marketEventQueue: string;
}

function trimMainnetJson() {
    // Read the local mainnet.json file
    // const mainnetData = JSON.parse(fs.readFileSync('./mainnet.json', 'utf-8'));

    // read large file approx 1GB
    const stream = fs.createReadStream('./mainnet.json');
    const parser = JSONStream.parse('*');


    // Get the token addresses from swapConfig
    const { tokenAAddress, tokenBAddress } = swapConfig;

    let foundData;
    stream.pipe(parser)
        .on('data', (mainnetData) => {
            // Process each chunk of data here
            // For example, you can filter or transform the data

            // Find the pool that matches the token pair in both official and unofficial pools
            const relevantPool = [...mainnetData.official, ...(mainnetData.unOfficial || [])].find((pool: PoolInfo) =>
                (pool.baseMint === tokenAAddress && pool.quoteMint === tokenBAddress) ||
                (pool.baseMint === tokenBAddress && pool.quoteMint === tokenAAddress)
            );

            if (!relevantPool) {
                console.error('No matching pool found for the given token pair');
                return;
            }

            foundData = relevantPool;

        })
        .on('end', () => {
            console.log('Finished processing the JSON file.');
        })
        .on('error', (error) => {
            console.error('Error reading or parsing mainnet.json:', error);
        });







    // Create a new object with only the necessary information
    const trimmedData = {
        official: [foundData]
    };

    // Write the trimmed data to a new file
    fs.writeFileSync('trimmed_mainnet.json', JSON.stringify(trimmedData, null, 2));

    console.log('Trimmed mainnet.json file has been created as trimmed_mainnet.json');
}

// trimMainnetJson();


async function getPoolKeys(ammId: string) {
    // // API
    // https://api-v3.raydium.io/pools/key/ids?ids=9Exta8xZivjJaqtRu7BM9gvKtm9DDyj2dppotLiBNKuh
    // // Expected response
    // {
    //     "id": "5a80cf1b-ce24-43c6-9565-024a182dc6a0",
    //         "success": true,
    //             "data": [
    //                 {
    //                     "programId": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    //                     "id": "9Exta8xZivjJaqtRu7BM9gvKtm9DDyj2dppotLiBNKuh",
    //                     "mintA": {
    //                         "chainId": 101,
    //                         "address": "Eme2rD2xttT7kboSuzdQov71Sk8EL9Yn1DvXynhL5oww",
    //                         "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    //                         "logoURI": "https://img-v1.raydium.io/icon/Eme2rD2xttT7kboSuzdQov71Sk8EL9Yn1DvXynhL5oww.png",
    //                         "symbol": "MEMEAGENT",
    //                         "name": "Meme World Agent",
    //                         "decimals": 6,
    //                         "tags": [],
    //                         "extensions": {}
    //                     },
    //                     "mintB": {
    //                         "chainId": 101,
    //                         "address": "So11111111111111111111111111111111111111112",
    //                         "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    //                         "logoURI": "https://img-v1.raydium.io/icon/So11111111111111111111111111111111111111112.png",
    //                         "symbol": "WSOL",
    //                         "name": "Wrapped SOL",
    //                         "decimals": 9,
    //                         "tags": [],
    //                         "extensions": {}
    //                     },
    //                     "lookupTableAccount": "Cc4f2uxt6ErTXUN3K7VzxW3NXQyKAdmXd3ZfJeJW7Ur",
    //                     "openTime": "1734578578",
    //                     "vault": {
    //                         "A": "3hepj7H64s82hz5p1nWx6AakKPqsU77yD26KeXzGoJjt",
    //                         "B": "2mjtSRMHdYGjG2LsX7B3Se7y5xkh9p8r1yiBZhSQhV7Q"
    //                     },
    //                     "authority": "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    //                     "openOrders": "3ezGUxGDg3TaCxxEagejq3Lv2gCnAJEqnNgKFxXQpsBG",
    //                     "targetOrders": "E7SGaB6eihk8buxorcvVvvyC7smeo1wdkLXMEeEvqns4",
    //                     "mintLp": {
    //                         "chainId": 101,
    //                         "address": "4K7bCva9vLEvK1JgTYZd6Rwo49oiBwqxoNg6nqcViCjn",
    //                         "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    //                         "logoURI": "",
    //                         "symbol": "",
    //                         "name": "",
    //                         "decimals": 6,
    //                         "tags": [],
    //                         "extensions": {}
    //                     },
    //                     "marketProgramId": "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX",
    //                     "marketId": "HQvkLFsG4fzMn9VkfXVD3exjCtgkLsQXbWBQYgovRNpn",
    //                     "marketAuthority": "32EuN7zK5Rrqad4XxUv2CJV6tAnQoXnE8rRx8LHiGENB",
    //                     "marketBaseVault": "EvvLw6JN7v3wHPf2qM5Rr8DLjvpRwT9uhNw8dyVRz26d",
    //                     "marketQuoteVault": "9P8UmuoCTYbNM6p9fq5VibesPA8Z2krxvLqQZouRLwLF",
    //                     "marketBids": "BMQ3U6fy1NkN7z63e2pJKfSe7gqgFSFL8YMMo5Vgimjb",
    //                     "marketAsks": "CSaANNih55Gqhp5yjh9YgZUYzk6m3aoWFoKEFTGET6xY",
    //                     "marketEventQueue": "HEsztxjbrzLkgzMgUsmh9Dho3oShfcfqpccAU9gikxNT"
    //                 }
    //             ]
    // }
    // // Post Cleaning Output Schema
    // {
    //     "official": [
    //         {
    //             "id": "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
    //             "baseMint": "So11111111111111111111111111111111111111112",
    //             "quoteMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    //             "lpMint": "8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu",
    //             "baseDecimals": 9,
    //             "quoteDecimals": 6,
    //             "lpDecimals": 9,
    //             "version": 4,
    //             "programId": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    //             "authority": "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    //             "openOrders": "HmiHHzq4Fym9e1D4qzLS6LDDM3tNsCTBPDWHTLZ763jY",
    //             "targetOrders": "CZza3Ej4Mc58MnxWA385itCC9jCo3L1D7zc3LKy1bZMR",
    //             "baseVault": "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz",
    //             "quoteVault": "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz",
    //             "withdrawQueue": "11111111111111111111111111111111",
    //             "lpVault": "11111111111111111111111111111111",
    //             "marketVersion": 4,
    //             "marketProgramId": "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX",
    //             "marketId": "8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6",
    //             "marketAuthority": "CTz5UMLQm2SRWHzQnU62Pi4yJqbNGjgRBHqqp6oDHfF7",
    //             "marketBaseVault": "CKxTHwM9fPMRRvZmFnFoqKNd9pQR21c5Aq9bh5h9oghX",
    //             "marketQuoteVault": "6A5NHCj1yF6urc9wZNe6Bcjj4LVszQNj5DwAWG97yzMu",
    //             "marketBids": "5jWUncPNBMZJ3sTHKmMLszypVkoRK6bfEQMQUHweeQnh",
    //             "marketAsks": "EaXdHx7x3mdGA38j5RSmKYSXMzAFzzUXCLNBEDXDn1d5",
    //             "marketEventQueue": "8CvwxZ9Db6XbLD46NZwwmVDZZRDy7eydFcAGkXKh9axa",
    //             "lookupTableAccount": "3q8sZGGpPESLxurJjNmr7s7wcKS5RPCCHMagbuHP9U2W"
    //         }
    //     ]
    // }
    const poolKeys = await axios.get(`https://api-v3.raydium.io/pools/key/ids?ids=${ammId}`);
    
    let output = {
        official: [
            {
                id: poolKeys.data.data[0].id,
                baseMint: poolKeys.data.data[0].mintA.address,
                quoteMint: poolKeys.data.data[0].mintB.address,
                lpMint: poolKeys.data.data[0].mintLp.address,
                baseDecimals: poolKeys.data.data[0].mintA.decimals,
                quoteDecimals: poolKeys.data.data[0].mintB.decimals,
                lpDecimals: poolKeys.data.data[0].mintLp.decimals,
                version: 4,
                programId: poolKeys.data.data[0].programId,
                authority: poolKeys.data.data[0].authority,
                openOrders: poolKeys.data.data[0].openOrders,
                targetOrders: poolKeys.data.data[0].targetOrders,
                baseVault: poolKeys.data.data[0].vault.A,
                quoteVault: poolKeys.data.data[0].vault.B,
                "withdrawQueue": "11111111111111111111111111111111",
                "lpVault": "11111111111111111111111111111111",
                marketVersion: 4,
                marketProgramId: poolKeys.data.data[0].marketProgramId,
                marketId: poolKeys.data.data[0].marketId,
                marketAuthority: poolKeys.data.data[0].marketAuthority,
                marketBaseVault: poolKeys.data.data[0].marketBaseVault,
                marketQuoteVault: poolKeys.data.data[0].marketQuoteVault,
                marketBids: poolKeys.data.data[0].marketBids,
                marketAsks: poolKeys.data.data[0].marketAsks,
                marketEventQueue: poolKeys.data.data[0].marketEventQueue,
                lookupTableAccount: poolKeys.data.data[0].lookupTableAccount,
            }
        ]
    }

    console.log(output);
    fs.writeFileSync('trimmed_mainnet_token_pair.json', JSON.stringify(output, null, 2));
}

getPoolKeys('AQGWVCaHQUpDcrLeg3YehPbWF7gWtXzXe1W65dur5ajq');