#!/usr/bin/env node

/**
 * Verification Script for SOL Payment Fix
 * 
 * This script tests that the SOL payment reference inclusion fix works correctly
 * by creating a mock transaction and verifying the reference is included properly.
 */

const { Connection, PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } = require('@solana/web3.js');
const { createTransferWithAta } = require('../../src/services/solana');
const BigNumber = require('bignumber.js');

async function testSOLReferenceInclusion() {
    console.log('🔧 Testing SOL Payment Reference Inclusion Fix...\n');

    try {
        // Create test keypairs
        const sender = Keypair.generate();
        const recipient = Keypair.generate();
        const reference = Keypair.generate();

        console.log('📋 Test Setup:');
        console.log(`   Sender: ${sender.publicKey.toString()}`);
        console.log(`   Recipient: ${recipient.publicKey.toString()}`);
        console.log(`   Reference: ${reference.publicKey.toString()}\n`);

        // Mock connection (we won't actually send this)
        const mockConnection = {
            getAccountInfo: jest.fn().mockResolvedValue({
                lamports: 1000000000, // 1 SOL
                data: Buffer.alloc(0),
                owner: SystemProgram.programId,
                executable: false,
                rentEpoch: 0
            }),
            getLatestBlockhash: jest.fn().mockResolvedValue({
                blockhash: 'test-blockhash',
                lastValidBlockHeight: 12345
            })
        };

        // Create transfer parameters
        const transferParams = {
            recipient: recipient.publicKey,
            amount: new BigNumber(0.1), // 0.1 SOL
            splToken: null, // Native SOL transfer
            reference: reference.publicKey,
            memo: 'Test SOL payment with reference'
        };

        console.log('🔨 Creating SOL transfer transaction...');

        // Create the transaction using our fixed function
        const transaction = await createTransferWithAta(mockConnection, sender.publicKey, transferParams);

        console.log('✅ Transaction created successfully!\n');

        // Analyze the transaction structure
        console.log('📊 Transaction Analysis:');
        console.log(`   Instructions count: ${transaction.instructions.length}`);

        let referenceFound = false;
        let transferInstructionFound = false;
        let memoInstructionFound = false;

        transaction.instructions.forEach((instruction, index) => {
            console.log(`\n   Instruction ${index + 1}:`);
            console.log(`     Program ID: ${instruction.programId.toString()}`);
            console.log(`     Keys count: ${instruction.keys.length}`);

            // Check if this is the transfer instruction
            if (instruction.programId.equals(SystemProgram.programId)) {
                transferInstructionFound = true;
                console.log(`     Type: SystemProgram Transfer`);

                // Check if reference is included in the keys
                instruction.keys.forEach((key, keyIndex) => {
                    console.log(`       Key ${keyIndex + 1}: ${key.pubkey.toString()} (signer: ${key.isSigner}, writable: ${key.isWritable})`);

                    if (key.pubkey.equals(reference.publicKey)) {
                        referenceFound = true;
                        console.log(`       ✅ REFERENCE FOUND as account key!`);
                    }
                });
            }

            // Check if this is a memo instruction
            if (instruction.programId.toString() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
                memoInstructionFound = true;
                console.log(`     Type: Memo Program`);
                console.log(`     Data: ${instruction.data.toString('utf8')}`);
            }
        });

        console.log('\n🎯 Verification Results:');
        console.log(`   ✅ Transfer instruction found: ${transferInstructionFound}`);
        console.log(`   ✅ Memo instruction found: ${memoInstructionFound}`);
        console.log(`   ${referenceFound ? '✅' : '❌'} Reference included as account key: ${referenceFound}`);

        if (referenceFound) {
            console.log('\n🎉 SUCCESS: SOL payment reference fix is working correctly!');
            console.log('   The reference is now properly included as an account key in the transfer instruction.');
            console.log('   This should allow @solana/pay findReference to locate SOL transactions.');
        } else {
            console.log('\n❌ FAILURE: Reference not found in transaction account keys.');
            console.log('   The fix may not be working correctly.');
        }

        return referenceFound;

    } catch (error) {
        console.error('\n❌ Error testing SOL reference inclusion:', error.message);
        return false;
    }
}

// Mock jest functions for the test
global.jest = {
    fn: () => ({
        mockResolvedValue: (value) => () => Promise.resolve(value)
    })
};

// Run the test
if (require.main === module) {
    testSOLReferenceInclusion()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testSOLReferenceInclusion };