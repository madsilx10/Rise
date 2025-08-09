const { ethers } = require('ethers');
const readline = require('readline');

// Konfigurasi Rise Testnet
const CONFIG = {
    NETWORK: {
        name: 'RISE Testnet',
        rpcUrl: 'https://testnet.riselabs.xyz',
        chainId: 11155931,
        explorer: 'https://explorer.testnet.riselabs.xyz'
    },
    
    // Contract Addresses
    ROUTER_ADDRESS: '0x5eC9BEaCe4a0f46F77945D54511e2b454cb8F38E',
    
    TOKENS: {
        MOG: {
            address: '0x99dBE4AEa58E518C50a1c04aE9b48C9F6354612f',
            symbol: 'MOG',
            decimals: 18
        },
        WETH: {
            address: '0x4200000000000000000000000000000000000006',
            symbol: 'WETH',
            decimals: 18
        },
        RISE: {
            address: '0xd6e1afe5cA8D00A2EFC01B89997abE2De47fdfAf',
            symbol: 'RISE',
            decimals: 18
        },
        USDT: {
            address: '0x40918Ba7f132E0aCba2CE4de4c4baF9BD2D7D849',
            symbol: 'USDT',
            decimals: 6
        }
    },
    
    // Swap Settings
    SWAP_AMOUNT_MIN: '0.5',  // Amount minimum (0.5-2 range bagus buat balance kamu)
    SWAP_AMOUNT_MAX: '2',    // Amount maximum
    DELAY_MIN: 15000, // 15 detik
    DELAY_MAX: 30000, // 30 detik
    MAX_SWAPS: 50, // Total swap yang akan dilakukan
    SLIPPAGE: 500 // 5% dalam basis points
};

// ERC20 ABI (minimal untuk approve & balance)
const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
];

// Uniswap V2 Router ABI (minimal untuk swap)
const ROUTER_ABI = [
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

class RiseAutoSwapper {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.router = null;
        this.tokenContracts = {};
        this.swapCount = 0;
        this.successCount = 0;
        this.failureCount = 0;
    }

    async initialize() {
        console.log('🚀 Rise Testnet Auto Swapper');
        console.log('================================\n');

        // Input private key secara aman
        const privateKey = await this.getPrivateKeyInput();
        
        try {
            // Setup provider dan wallet
            this.provider = new ethers.providers.JsonRpcProvider(CONFIG.NETWORK.rpcUrl);
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            this.router = new ethers.Contract(CONFIG.ROUTER_ADDRESS, ROUTER_ABI, this.wallet);

            console.log(`🔗 Connected to ${CONFIG.NETWORK.name}`);
            console.log(`👛 Wallet: ${this.wallet.address}\n`);

            // Setup token contracts
            for (const [key, token] of Object.entries(CONFIG.TOKENS)) {
                this.tokenContracts[key] = new ethers.Contract(token.address, ERC20_ABI, this.wallet);
            }

            // Check balances
            await this.checkBalances();
            
            // Approve tokens
            await this.approveTokens();

            return true;
        } catch (error) {
            console.error('❌ Error during initialization:', error.message);
            return false;
        }
    }

    async getPrivateKeyInput() {
        return new Promise((resolve) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question('🔐 Masukkan private key (tanpa 0x): ', (privateKey) => {
                rl.close();
                // Add 0x prefix if not present
                resolve(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);
            });
        });
    }

    async checkBalances() {
        console.log('💰 Checking token balances...');
        console.log('--------------------------------');
        
        for (const [key, token] of Object.entries(CONFIG.TOKENS)) {
            try {
                const balance = await this.tokenContracts[key].balanceOf(this.wallet.address);
                const decimals = token.decimals;
                const formattedBalance = ethers.utils.formatUnits(balance, decimals);
                console.log(`${token.symbol}: ${formattedBalance}`);
            } catch (error) {
                console.log(`${token.symbol}: Error reading balance`);
            }
        }
        console.log('');
    }

    async approveTokens() {
        console.log('✅ Approving tokens...');
        
        for (const [key, token] of Object.entries(CONFIG.TOKENS)) {
            try {
                const maxApproval = ethers.constants.MaxUint256;
                const tx = await this.tokenContracts[key].approve(CONFIG.ROUTER_ADDRESS, maxApproval);
                console.log(`Approving ${token.symbol}... TX: ${tx.hash}`);
                await tx.wait(1);
            } catch (error) {
                console.log(`Failed to approve ${token.symbol}: ${error.message}`);
            }
        }
        console.log('');
    }

    getRandomTokenPair() {
        const tokenKeys = Object.keys(CONFIG.TOKENS);
        const fromToken = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
        let toToken = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
        
        // Ensure different tokens
        while (toToken === fromToken) {
            toToken = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
        }
        
        return { fromToken, toToken };
    }

    async performSwap() {
        const { fromToken, toToken } = this.getRandomTokenPair();
        const fromTokenData = CONFIG.TOKENS[fromToken];
        const toTokenData = CONFIG.TOKENS[toToken];
        
        try {
            console.log(`🔄 Swap #${this.swapCount + 1}: ${fromTokenData.symbol} → ${toTokenData.symbol}`);
            
            // Random amount between min and max
            const randomAmount = (Math.random() * (parseFloat(CONFIG.SWAP_AMOUNT_MAX) - parseFloat(CONFIG.SWAP_AMOUNT_MIN)) + parseFloat(CONFIG.SWAP_AMOUNT_MIN)).toFixed(6);
            console.log(`💰 Amount: ${randomAmount} ${fromTokenData.symbol}`);
            
            // Calculate amount based on token decimals
            const amountIn = ethers.utils.parseUnits(randomAmount, fromTokenData.decimals);
            
            // Create path
            const path = [fromTokenData.address, toTokenData.address];
            
            // Get expected output
            const amountsOut = await this.router.getAmountsOut(amountIn, path);
            const amountOutMin = amountsOut[1].mul(10000 - CONFIG.SLIPPAGE).div(10000);
            
            // Set deadline (5 minutes from now)
            const deadline = Math.floor(Date.now() / 1000) + 300;
            
            // Perform swap
            const tx = await this.router.swapExactTokensForTokens(
                amountIn,
                amountOutMin,
                path,
                this.wallet.address,
                deadline,
                { gasLimit: 200000 }
            );
            
            console.log(`📤 TX Hash: ${tx.hash}`);
            const receipt = await tx.wait(1);
            console.log(`✅ Confirmed in block: ${receipt.blockNumber}\n`);
            
            this.successCount++;
            return true;
            
        } catch (error) {
            console.error(`❌ Swap failed: ${error.message}\n`);
            this.failureCount++;
            return false;
        }
    }

    async startAutoSwapping() {
        console.log(`🎯 Starting auto swap with random pairs`);
        console.log(`📊 Target: ${CONFIG.MAX_SWAPS} swaps`);
        console.log(`⏱️  Delay: ${CONFIG.DELAY_MIN/1000}-${CONFIG.DELAY_MAX/1000} seconds\n`);

        while (this.swapCount < CONFIG.MAX_SWAPS) {
            await this.performSwap();
            this.swapCount++;
            
            // Show progress
            console.log(`📈 Progress: ${this.swapCount}/${CONFIG.MAX_SWAPS} | Success: ${this.successCount} | Failed: ${this.failureCount}`);
            
            if (this.swapCount < CONFIG.MAX_SWAPS) {
                // Random delay between min and max
                const delay = Math.floor(Math.random() * (CONFIG.DELAY_MAX - CONFIG.DELAY_MIN)) + CONFIG.DELAY_MIN;
                console.log(`⏳ Waiting ${delay/1000} seconds...\n`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        this.showFinalSummary();
    }

    showFinalSummary() {
        console.log('\n' + '='.repeat(50));
        console.log('🏁 AUTO SWAP COMPLETED');
        console.log('='.repeat(50));
        console.log(`Total Swaps: ${this.swapCount}`);
        console.log(`✅ Successful: ${this.successCount}`);
        console.log(`❌ Failed: ${this.failureCount}`);
        console.log(`📊 Success Rate: ${((this.successCount/this.swapCount)*100).toFixed(2)}%`);
        console.log(`🔗 Explorer: ${CONFIG.NETWORK.explorer}/address/${this.wallet.address}`);
        console.log('='.repeat(50));
    }
}

// Main execution
async function main() {
    const swapper = new RiseAutoSwapper();
    
    if (await swapper.initialize()) {
        console.log('Press Ctrl+C to stop anytime...\n');
        await swapper.startAutoSwapping();
    } else {
        console.log('❌ Initialization failed');
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Stopping auto swapper...');
    process.exit(0);
});

// Run the script
main().catch(console.error);