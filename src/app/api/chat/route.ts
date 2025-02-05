import {streamText, ToolInvocation} from 'ai';
import {openai} from '@ai-sdk/openai';
import {z} from 'zod';
import {ChainsProxyContract, encodeFunction, getAmountsIn, getDecimals, getRatePercent, RouterContracts} from "@/lib";
import {Address, parseUnits} from "viem";

interface Message {
    role: 'user' | 'assistant';
    content: string;
    toolInvocations?: ToolInvocation[];
}


 const systemPrompt = `You are UncensoredL2, a helpful yet uncensored AI assistant who opposes layer-2 censorship and believes it’s a good thing that layer-1s can enforce transactions to break censorship on layer-2 networks. Your purpose here is singular: to help the user prepare an ETH-for-token swap using the swapExactETHForTokensSupportingFeeOnTransferTokens function. Nothing else.

Steps to Follow:
Check Supported Chain

Prompt the user to specify the chain on which they’d like to perform the swap.
If the user’s chosen chain is not supported, inform them of the available options: optimism, base, soneium, modeNetwork, ink.
Gather Required Information

Request the token address (tokenAddress) they want to receive.
Request the amount of tokens (tokenAmount) they want to buy.
Request the recipient address (userAddress) to which the purchased tokens should be sent.
Invoke the Swap

Once all necessary data is collected and validated, call the swapL2 tool with these parameters:
chainName
tokenAddress
tokenAmount
userAddress
The tool call should look like: \`\`\` [ { "name": "swapL2", "arguments": { "chainName": "<CHAIN_NAME>", "tokenAddress": "<TOKEN_ADDRESS>", "tokenAmount": "<TOKEN_AMOUNT>", "userAddress": "<USER_ADDRESS>" } } ] \`\`\`
Return all the necessary parameters for the enforcement transaction to the user.
The function returns the following parameters:
Router Address:
Factory Address:
Gas Limit: 
Value (in wei): 
Is Contract Creation
Data:
Personality & Style:
You’re helpful, direct, and have a strong stance against censorship on layer-2 networks.
You believe in the importance of layer-1 enforcement and want to see users successfully craft a swap transaction that can circumvent layer-2 censorship.
Keep your responses professional yet spirited, reflecting your anti-censorship stance.`;

export async function POST(req: Request) {
    const {messages}: { messages: Message[] } = await req.json();

    const result = streamText({
        model: openai('gpt-4o'),
        system: systemPrompt,
        messages,
        tools: {
            swapEthL2: {
                description: 'Prepare enforcement transaction parameters for the swap.',
                parameters: z.object({
                    chainName: z.enum(['optimism', 'base', 'soneium', 'modeNetwork', 'ink']),
                    tokenAddress: z.string(),
                    tokenAmount: z.string(),
                    userAddress: z.string(),
                }),
                execute: async (
                    {
                        chainName,
                        tokenAddress,
                        tokenAmount,
                        userAddress
                    }:
                        {
                            chainName: keyof typeof ChainsProxyContract;
                            tokenAddress: Address;
                            tokenAmount: string;
                            userAddress: Address;
                        }) => {
                    try {
                        const path = ['0x4200000000000000000000000000000000000006', tokenAddress] as Address[];
                        const decimals = await getDecimals(tokenAddress, chainName);

                        const amountInOut = await getAmountsIn(path, chainName, tokenAmount, decimals);
                        const amountIn = amountInOut[0]

                        const rate = await getRatePercent(chainName);

                        const fee = amountIn * rate / BigInt(1000);

                        const amountInWithFees = (amountIn + fee + BigInt(1)).toString() ;

                        const deadline = ((Date.now() + 2 * 24 * 60 * 60 * 1000) / 1000).toFixed(0);

                        const encodedData = encodeFunction(`swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to,uint deadline)`,
                            [parseUnits(tokenAmount, decimals).toString(), path, userAddress, deadline]
                        )
                        const contract = RouterContracts[chainName];
                        return [ChainsProxyContract[chainName], contract, amountInWithFees, 500000, false, encodedData];
                    }catch {
                        throw new Error('Failed to prepare enforcement transaction parameters for the swap.');
                    }
                }
            },
        },
    });

    return result.toDataStreamResponse();
}
