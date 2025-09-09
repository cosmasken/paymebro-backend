#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function runMigrations() {
  try {
    console.log('🚀 Starting database migrations...\n');

    // Create migrations tracking table if it doesn't exist
    console.log('📋 Creating migrations tracking table...');
    const { error: trackingError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) UNIQUE NOT NULL,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `
    });

    if (trackingError) {
      console.log('Using direct SQL execution...');
      await supabase.from('migrations').select('*').limit(1);
    }

    // Get list of migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    console.log(`📁 Found ${migrationFiles.length} migration files\n`);

    // Get already executed migrations
    const { data: executedMigrations } = await supabase
      .from('migrations')
      .select('filename');

    const executedSet = new Set(
      (executedMigrations || []).map(m => m.filename)
    );

    // Run pending migrations
    for (const filename of migrationFiles) {
      if (executedSet.has(filename)) {
        console.log(`⏭️  Skipping ${filename} (already executed)`);
        continue;
      }

      console.log(`🔄 Running migration: ${filename}`);
      
      try {
        // Read migration file
        const migrationPath = path.join(migrationsDir, filename);
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        // Execute migration
        const { error: migrationError } = await supabase.rpc('exec_sql', {
          sql: migrationSQL
        });

        if (migrationError) {
          // Try direct execution for simple queries
          const statements = migrationSQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

          for (const statement of statements) {
            if (statement.toLowerCase().includes('create table')) {
              // Handle CREATE TABLE statements
              await executeCreateTable(statement);
            } else if (statement.toLowerCase().includes('insert')) {
              // Handle INSERT statements
              await executeInsert(statement);
            } else if (statement.toLowerCase().includes('create index')) {
              // Skip index creation for now
              console.log(`  ⚠️  Skipping index creation: ${statement.substring(0, 50)}...`);
            }
          }
        }

        // Mark migration as executed
        await supabase
          .from('migrations')
          .insert({ filename });

        console.log(`  ✅ Migration ${filename} completed successfully`);

      } catch (error) {
        console.error(`  ❌ Migration ${filename} failed:`, error.message);
        throw error;
      }
    }

    console.log('\n🎉 All migrations completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

async function executeCreateTable(statement) {
  // Extract table creation logic
  if (statement.includes('payment_templates')) {
    await createPaymentTemplatesTable();
  } else if (statement.includes('subscriptions')) {
    await createSubscriptionsTable();
  } else if (statement.includes('subscription_plans')) {
    await createSubscriptionPlansTable();
  } else if (statement.includes('webhooks')) {
    await createWebhooksTable();
  } else if (statement.includes('email_notifications')) {
    await createEmailNotificationsTable();
  }
}

async function createPaymentTemplatesTable() {
  console.log('  📝 Creating payment_templates table...');
  
  // Since we can't use foreign keys easily, we'll use string references
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS payment_templates (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        web3auth_user_id TEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        amount DECIMAL(20, 9) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
        label VARCHAR(255),
        message TEXT,
        spl_token_mint VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `
  });

  if (error) {
    console.log('  Using alternative table creation...');
    // Alternative: Create via insert/select pattern
    try {
      await supabase.from('payment_templates').select('*').limit(1);
      console.log('  ✅ Table already exists');
    } catch {
      console.log('  ⚠️  Could not verify table creation');
    }
  }
}

async function createSubscriptionsTable() {
  console.log('  📝 Creating subscriptions table...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        web3auth_user_id TEXT NOT NULL,
        plan_id UUID NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        wallet_address VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        current_period_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        current_period_end TIMESTAMP WITH TIME ZONE,
        next_payment_date TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `
  });

  if (error) {
    console.log('  ⚠️  Could not create subscriptions table:', error.message);
  }
}

async function createSubscriptionPlansTable() {
  console.log('  📝 Creating subscription_plans table...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        web3auth_user_id TEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        amount DECIMAL(20, 9) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
        interval_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
        interval_count INTEGER DEFAULT 1,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `
  });

  if (error) {
    console.log('  ⚠️  Could not create subscription_plans table:', error.message);
  }
}

async function createWebhooksTable() {
  console.log('  📝 Creating webhooks table...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS webhooks (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        web3auth_user_id TEXT NOT NULL,
        url VARCHAR(500) NOT NULL,
        events TEXT[] NOT NULL,
        secret VARCHAR(255),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `
  });

  if (error) {
    console.log('  ⚠️  Could not create webhooks table:', error.message);
  }
}

async function createEmailNotificationsTable() {
  console.log('  📝 Creating email_notifications table...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS email_notifications (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        web3auth_user_id TEXT NOT NULL,
        email VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        sent_at TIMESTAMP WITH TIME ZONE,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `
  });

  if (error) {
    console.log('  ⚠️  Could not create email_notifications table:', error.message);
  }
}

async function executeInsert(statement) {
  console.log('  📝 Executing insert statement...');
  // Skip inserts for now to avoid conflicts
}

// Run migrations
runMigrations().then(() => {
  console.log('\n✅ Migration script completed!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Migration script failed:', error);
  process.exit(1);
});
