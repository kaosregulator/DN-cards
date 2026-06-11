# Discord Bot UI Modernization Strategy
## Component-Based Interactions for Modern UX

**Status:** Planning Phase  
**Target:** Modern, mobile-friendly, game-like experience  
**Inspiration:** Roblox inventory systems, Discord.js apps, collectible card games

---

## Executive Summary

The current DN Cards bot relies heavily on **slash commands** and text input, requiring users to remember command syntax and type precisely. This modernization replaces command-heavy workflows with **Discord Components** (buttons, select menus, modals) to create an intuitive, game-like experience similar to modern Roblox interfaces.

### Key Goals
- **Minimal typing:** Buttons and dropdowns for 90% of actions
- **Mobile-friendly:** Touch-optimized component layout (max 5 buttons per row)
- **Guided workflows:** Step-by-step navigation with visual feedback
- **Modern aesthetics:** Consistent emojis, colors, and styling
- **Accessibility:** Clear labels, confirmations, and undo options

---

## Current State Analysis

### Existing Patterns
✅ **Already using components:**
- Trade proposal buttons (`trade_accept`, `trade_decline`)
- Paginator with category selection
- Some button-based interactions

❌ **Command-heavy pain points:**
- `/collection` requires understanding subcommands
- `/burn name:<Card>` requires exact card name typing
- `/trade` requires manual card/shard input
- `/pack` requires tier selection via slash args
- No discovery mechanism for new players

---

## Target Experience

### Main Menu (Entry Point)

```
🎴 DN Cards — Main Menu
─────────────────────────

[🎴 Collection]  [📦 Packs]  [🔥 Burn]  [🤝 Trade]
[💠 Shards]      [📅 Daily]  [⚙️ Sets] [🏆 Leaderboard]
```

Each button state persists for 5 minutes (or until user navigates away).

### Collection Browser

```
🎴 Your Collection
─────────────────

Unique: 47 cards | Total: 156 cards
💠 Net Worth: 48,500 shards | Rank: Lieutenant ⚔️

[Common ▼] [Uncommon ▼] [Rare ▼] [Epic ▼] [Legendary ▼]
  └─ Select Rarity

[⬜ ⬜ ⬜ ⬜ ⬜ ⬜]  <- Shows 6 owned cards in rarity
[◄] [Card Name ▼] [►]  <- Navigate owned cards

┌─ Card Detail ─────────────────┐
│ M1 Abrams                      │
│ Rarity: Uncommon (🎖️)         │
│ You have: 3 copies · 1 shiny  │
│ Worth: 125 💠 each             │
│ 💠 Total: 375 shards           │
└────────────────────────────────┘

[👁️ View] [🔥 Burn] [🎁 Trade] [⭐ Favorite]
```

---

## Component Architecture

### 1. Message Structure

Each interaction message should have:
- **Embed:** Visual data display (card details, stats, etc.)
- **Select Menus:** Navigation and filtering (max 1-2 per row)
- **Buttons:** Actions (max 5 per row, typically 3-4)
- **Modal:** Complex input (burn amount, trade offer)

**Constraints:**
- Max 5 components per ActionRow
- Max 5 ActionRows per message (25 buttons total, but ~20 is practical)
- Separate concerns: one row for navigation, one for actions

### 2. Discord Component Types

| Component | Use Case | Max Items | Mobile |
|-----------|----------|-----------|--------|
| **SelectMenu** | Category/rarity filtering | 25 options | ✅ Good |
| **Button** | Single actions | 5/row | ✅ Good |
| **Modal** | Multi-field input | Unlimited | ✅ Good |
| **TextInput** | Single text field | 1 | ✅ Good |

### 3. Custom ID Naming Convention

```
[feature]_[action]_[modifier]:[id]

Examples:
- collection_rarity_select:common
- collection_card_next:47
- burn_amount_modal:card-123
- trade_create_modal:target-user-id
- pack_tier_select:basic
```

---

## Detailed Workflows

### A. Collection Browser Workflow

#### Step 1: Initial Menu
```typescript
// Command: /collection (or button in main menu)
// Shows overview + navigation

const embed = new EmbedBuilder()
  .setTitle(`🃏 ${target.username}'s Collection`)
  .setDescription(`
    **📊 Stats:**
    • Unique: 47 cards | Total: 156 cards
    • 💠 Net Worth: 48,500 shards
    • 🎖️ Rank: Lieutenant (⚔️ 50/75 to next)
    • 🏅 #23 by net worth · #18 by card count
    
    **🏆 Achievements:** 7/10 unlocked
    ✨ 🔥 🎣 💼 🏆 🌟 🤝
  `)
  .setThumbnail(target.displayAvatarURL());

// Navigation buttons
const rarityRow = new ActionRowBuilder<SelectMenuBuilder>()
  .addComponents(
    new SelectMenuBuilder()
      .setCustomId('collection_rarity_select')
      .setPlaceholder('📂 Select Rarity...')
      .addOptions([
        { label: 'Common', value: 'common', emoji: '⚪' },
        { label: 'Uncommon', value: 'uncommon', emoji: '🟢' },
        { label: 'Rare', value: 'rare', emoji: '🔵' },
        { label: 'Epic', value: 'epic', emoji: '🟣' },
        { label: 'Legendary', value: 'legendary', emoji: '🟡' },
        { label: 'Mythic', value: 'mythic', emoji: '🌟' },
        { label: 'Limited Edition', value: 'limited', emoji: '💎' },
        { label: 'Event Exclusive', value: 'event', emoji: '🎆' },
        { label: 'Shinies ✨', value: 'shiny', emoji: '✨' },
      ])
  );

// Quick action buttons
const quickActionsRow = new ActionRowBuilder<ButtonBuilder>()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('collection_overview')
      .setLabel('Overview')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🏠'),
    new ButtonBuilder()
      .setCustomId('collection_stats')
      .setLabel('Stats')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📊'),
    new ButtonBuilder()
      .setCustomId('collection_achievements')
      .setLabel('Achievements')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🏆'),
  );

await interaction.reply({
  embeds: [embed],
  components: [rarityRow, quickActionsRow],
  ephemeral: false,
});
```

#### Step 2: Rarity Selected
```typescript
// User selects "Legendary" from dropdown

// New embed shows cards in that rarity
const legendaryEmbed = new EmbedBuilder()
  .setTitle(`🟡 Legendary — Your Collection`)
  .setDescription(`
    You own **3 unique** legendary cards
    Total copies: **5** · Net worth: 💠 **12,500**
  `);

// Card selection dropdown + details
const cardSelectRow = new ActionRowBuilder<SelectMenuBuilder>()
  .addComponents(
    new SelectMenuBuilder()
      .setCustomId('collection_card_select:legendary')
      .setPlaceholder('🎴 Pick a card...')
      .addOptions([
        { 
          label: 'Darknight Titan', 
          value: 'card-1001', 
          description: '×2 copies',
          emoji: '🟡'
        },
        { 
          label: 'Operation Zero', 
          value: 'card-1002', 
          description: '×2 copies · ✨×1 shiny',
          emoji: '🟡'
        },
        { 
          label: 'The Warlord', 
          value: 'card-1003', 
          description: '×1 copy',
          emoji: '🟡'
        },
      ])
  );

// Card detail + action buttons
const cardDetailRow = new ActionRowBuilder<ButtonBuilder>()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('collection_card_burn:card-1001')
      .setLabel('🔥 Burn')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('collection_card_trade:card-1001')
      .setLabel('🤝 Trade')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('collection_card_gift:card-1001')
      .setLabel('🎁 Gift')
      .setStyle(ButtonStyle.Secondary),
  );
```

#### Step 3: Card Actions
```typescript
// User clicks "🔥 Burn"

// Show modal for burn amount
const burnModal = new ModalBuilder()
  .setCustomId('burn_amount_modal:card-1001')
  .setTitle('🔥 Burn M1 Abrams')
  .addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('burn_amount_input')
        .setLabel('How many copies? (you have 3)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('1-3')
        .setRequired(true)
        .setMaxLength(1)
    ),
  );

await interaction.showModal(burnModal);

// After modal submission:
const burnEmbed = new EmbedBuilder()
  .setTitle('🔥 Burn Complete')
  .setDescription(`
    **Burned:** 🎖️ M1 Abrams ×2
    **Earned:** 💠 +250 shards
    **New balance:** 💠 45,250 shards
    **Remaining:** 1 copy
  `);
```

---

### B. Pack Store Workflow

#### Step 1: Tier Selection
```typescript
// Command: /packs (or button in main menu)

const packEmbed = new EmbedBuilder()
  .setTitle('📦 DN Cards — Pack Store')
  .setDescription(`
    💠 Your shards: **50,250**
    📅 Weekly limits (reset Monday 00:00 UTC):
  `);

// Tier selection buttons (prominent)
const tierSelectRow = new ActionRowBuilder<ButtonBuilder>()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('pack_tier_select:basic')
      .setLabel('🥉 Basic')
      .setStyle(ButtonStyle.Secondary)
      .setDescription('250 💠 · 50/week'),
    new ButtonBuilder()
      .setCustomId('pack_tier_select:premium')
      .setLabel('🥈 Premium')
      .setStyle(ButtonStyle.Secondary)
      .setDescription('750 💠 · 20/week'),
    new ButtonBuilder()
      .setCustomId('pack_tier_select:legendary')
      .setLabel('🥇 Legendary')
      .setStyle(ButtonStyle.Secondary)
      .setDescription('2,000 💠 · 5/week'),
  );

// Info buttons
const infoRow = new ActionRowBuilder<ButtonBuilder>()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('pack_stats')
      .setLabel('Stats')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📊'),
    new ButtonBuilder()
      .setCustomId('pack_guide')
      .setLabel('Guide')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❓'),
  );
```

#### Step 2: Tier Details
```typescript
// User clicks "🥈 Premium"

const premiumDetailEmbed = new EmbedBuilder()
  .setTitle('🥈 Premium Pack')
  .setColor(0xc0c0c0)
  .setDescription(`
    **Cost:** 💠 750 shards
    **Cards:** 5 cards per pack
    **Weekly limit:** 20 packs
    **This week:** 5/20 opened
    
    **Drop rates:**
    ⚪ Common: 40%
    🟢 Uncommon: 25%
    🔵 Rare: 22%
    🟣 Epic: 10%
    🟡 Legendary: 3%
    🌟 Mythic: 0%
    
    **EV Value:** ~787 💠 (slight house edge)
  `);

// Confirm + Info buttons
const confirmRow = new ActionRowBuilder<ButtonBuilder>()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('pack_open:premium')
      .setLabel('📦 Open Now')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('pack_tier_select:basic')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary),
  );
```

---

### C. Trading Workflow

#### Step 1: Trade Initiation
```typescript
// Command: /trade (or button in main menu)
// Shows user list to select target

const tradeInitEmbed = new EmbedBuilder()
  .setTitle('🤝 Propose a Trade')
  .setDescription('Pick a friend to trade with');

// User list (recent trade partners or online members)
const partnerSelectRow = new ActionRowBuilder<SelectMenuBuilder>()
  .addComponents(
    new SelectMenuBuilder()
      .setCustomId('trade_partner_select')
      .setPlaceholder('👥 Select trade partner...')
      .addOptions(
        // Top 25 recent partners
        { label: '@Alice', value: 'user-111', emoji: '👤' },
        { label: '@Bob', value: 'user-222', emoji: '👤' },
        { label: '@Charlie', value: 'user-333', emoji: '👤' },
        // ...
      )
  );
```

#### Step 2: Offer/Want Selection
```typescript
// After partner selected, show offer/want modals

const offerModal = new ModalBuilder()
  .setCustomId('trade_offer_modal:user-111')
  .setTitle('🤝 What are you offering?')
  .addComponents(
    new ActionRowBuilder<SelectMenuBuilder>().addComponents(
      new SelectMenuBuilder()
        .setCustomId('trade_offer_type')
        .setPlaceholder('Card or Shards?')
        .addOptions([
          { label: '🎴 Card', value: 'card' },
          { label: '💠 Shards', value: 'shards' },
          { label: '🎴 Card + 💠 Shards', value: 'both' },
        ])
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('trade_offer_input')
        .setLabel('Card name or shard amount')
        .setPlaceholder('e.g., "M1 Abrams" or "500"')
    ),
  );
```

#### Step 3: Confirmation
```typescript
// After both sides filled in, show proposal embed

const tradeProposalEmbed = new EmbedBuilder()
  .setTitle('🔄 Trade Proposal')
  .setColor(0x0984e3)
  .setDescription(`
    **You offer:** 🎖️ M1 Abrams ×1
    **You want:** 🔵 F-16 Fighting Falcon ×1
    
    ---
    
    **Alice offers:** 🔵 F-16 Fighting Falcon ×1
    **Alice wants:** 🎖️ M1 Abrams ×1
    
    ✅ **Fair trade** — both sides equal value
  `);

// Confirmation buttons
const confirmRow = new ActionRowBuilder<ButtonBuilder>()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('trade_confirm:user-111')
      .setLabel('✅ Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('trade_modify')
      .setLabel('Edit')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('trade_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );
```

---

### D. Burn Workflow

#### Single-Step Burn
```typescript
// Simplified flow for quick actions

const burnEmbed = new EmbedBuilder()
  .setTitle('🔥 Burn Card')
  .setDescription(`
    **Card:** 🎖️ M1 Abrams
    **You own:** 3 copies + 1 shiny
    **Burn value:** 62 💠 per copy
    **Will earn:** 62-124 💠
  `);

// Amount selector + confirm
const burnRow = new ActionRowBuilder<SelectMenuBuilder>()
  .addComponents(
    new SelectMenuBuilder()
      .setCustomId('burn_amount_select:card-123')
      .setPlaceholder('🔥 Burn how many?')
      .addOptions([
        { label: '1 copy', value: '1', emoji: '🔥' },
        { label: '2 copies', value: '2', emoji: '🔥🔥' },
        { label: '3 copies (all)', value: '3', emoji: '🔥🔥🔥' },
      ])
  );

const confirmRow = new ActionRowBuilder<ButtonBuilder>()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('burn_confirm:card-123:1')
      .setLabel('✅ Burn 1')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('burn_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
```

---

## Emoji & Visual System

### Standardized Emojis

| Concept | Primary | Variants |
|---------|---------|----------|
| **Collection** | 🃏 | 📂, 🎴 |
| **Packs** | 📦 | 🥉🥈🥇 (tiers) |
| **Burn** | 🔥 | ⚡ (energy) |
| **Trade** | 🤝 | 🔄 (flow) |
| **Shards** | 💠 | - |
| **Rank** | 🎖️ | 🏅, ⚔️ |
| **Rarity** | — | ⚪🟢🔵🟣🟡🌟 (by tier) |
| **Actions** | ✅/❌ | 👁️, 📖, ⭐ |
| **Time** | ⏱️ | ⏳, 📅 |

### Color Scheme (Dark Military Theme)

```
Primary:   #1a1a2e (Deep Navy)
Secondary: #16213e (Combat Navy)
Accent:    #0f3460 (Tactical Blue)

Success:   #06d6a0 (Combat Green)
Warning:   #ef476f (Alert Red)
Info:      #118ab2 (Info Blue)
Gold:      #ffd60a (Legendary Yellow)

Rarity Colors:
- Common:    #a8a8a8 (Gray)
- Uncommon:  #2dc653 (Green)
- Rare:      #1f7fff (Blue)
- Epic:      #a335ee (Purple)
- Legendary: #ffd700 (Gold)
- Mythic:    #ff1493 (Deep Pink)
```

### Embed Structure Template

```typescript
const embedTemplate = new EmbedBuilder()
  .setTitle('🎴 Feature Name')
  .setColor(0x1a1a2e)
  .setThumbnail(userAvatar)
  .setDescription(`
    [Primary info in bold]
    
    [Secondary details]
    • Detail 1
    • Detail 2
    • Detail 3
  `)
  .setFooter({ 
    text: 'Tip: Use buttons below for actions',
    iconURL: userAvatar,
  });
```

---

## Implementation Roadmap

### Phase 1: Component Handlers (Week 1-2)
- [ ] Build component interaction router
- [ ] Create SelectMenu handler factory
- [ ] Create Button handler factory
- [ ] Create Modal handler factory

### Phase 2: Collection Browser (Week 2-3)
- [ ] Rewrite `/collection` as component-based
- [ ] Implement rarity dropdown navigation
- [ ] Implement card selection carousel
- [ ] Implement card action buttons (view, burn, trade, favorite)

### Phase 3: Pack Store (Week 3-4)
- [ ] Rewrite `/pack` as button-based tier selector
- [ ] Add pack confirmation flow
- [ ] Add pack stats display
- [ ] Implement cooldown feedback

### Phase 4: Trading (Week 4-5)
- [ ] Convert `/trade` to modal-based workflow
- [ ] Implement partner selection dropdown
- [ ] Implement card/shard amount modals
- [ ] Add trade confirmation with fairness warnings

### Phase 5: Burn Flow (Week 5)
- [ ] Simplify `/burn` to dropdown + confirm
- [ ] Add shiny pile selector
- [ ] Add amount quick-select

### Phase 6: Main Menu Hub (Week 5-6)
- [ ] Create persistent main menu command
- [ ] Navigation buttons to each feature
- [ ] Quick stats display
- [ ] Recent activity indicator

### Phase 7: Polish (Week 6-7)
- [ ] Mobile testing and refinement
- [ ] Edge case handling (permissions, cooldowns)
- [ ] Error messages and validation
- [ ] Documentation and migration guide

---

## Code Structure

### Directory Organization

```
artifacts/api-server/src/bot/components/
├── handlers/
│   ├── selectMenuHandler.ts      # Route select menu events
│   ├── buttonHandler.ts           # Route button events
│   ├── modalHandler.ts            # Route modal submissions
│   └── componentRouter.ts         # Main dispatcher
├── builders/
│   ├── embeds.ts                  # Embed templates & builders
│   ├── buttons.ts                 # Button builders
│   ├── selectMenus.ts             # Select menu builders
│   └── modals.ts                  # Modal builders
├── interactions/
│   ├── collection/
│   │   ├── raritySelect.ts
│   │   ├── cardSelect.ts
│   │   ├── cardActions.ts
│   │   └── index.ts
│   ├── packs/
│   │   ├── tierSelect.ts
│   │   ├── tierDetail.ts
│   │   └── index.ts
│   ├── trading/
│   │   ├── partnerSelect.ts
│   │   ├── offerModal.ts
│   │   └── index.ts
│   └── burn/
│       ├── amountSelect.ts
│       └── index.ts
├── constants/
│   ├── emojis.ts                  # Emoji library
│   ├── colors.ts                  # Color palette
│   └── customIds.ts               # Custom ID patterns
└── utils/
    ├── componentBuilders.ts       # Common patterns
    └── validation.ts              # Input validation
```

### Example Handler

```typescript
// artifacts/api-server/src/bot/components/interactions/collection/raritySelect.ts

import type { SelectMenuInteraction } from "discord.js";
import { EmbedBuilder, SelectMenuBuilder, ActionRowBuilder } from "discord.js";
import { getUserCollection, getOrCreateGuildSettings } from "../../db.js";
import { RARITY_COLORS, RARITY_EMOJI } from "../../cards-data.js";

export async function handleRaritySelect(
  interaction: SelectMenuInteraction,
  rarity: string,
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  
  // Fetch collection for this rarity
  const collection = await getUserCollection(guildId, userId);
  const rarityCards = collection.filter(c => c.rarity === rarity);
  
  if (rarityCards.length === 0) {
    await interaction.reply({
      content: `You don't own any **${rarity}** cards yet!`,
      ephemeral: true,
    });
    return;
  }
  
  // Build dropdown with owned cards
  const cardOptions = rarityCards.map(card => ({
    label: card.name,
    value: `card-${card.id}`,
    description: `${card.count} copies${card.shinyCount ? ` + ${card.shinyCount} ✨` : ''}`,
    emoji: RARITY_EMOJI[rarity],
  }));
  
  const cardSelectMenu = new SelectMenuBuilder()
    .setCustomId('collection_card_select:' + rarity)
    .setPlaceholder(`🎴 Pick a ${rarity} card...`)
    .addOptions(cardOptions);
  
  const row = new ActionRowBuilder<SelectMenuBuilder>().addComponents(cardSelectMenu);
  
  const embed = new EmbedBuilder()
    .setTitle(`${RARITY_EMOJI[rarity]} ${rarity.toUpperCase()}`)
    .setColor(RARITY_COLORS[rarity])
    .setDescription(`${rarityCards.length} unique cards`);
  
  await interaction.update({
    embeds: [embed],
    components: [row],
  });
}
```

---

## Mobile Optimization

### Layout Rules

1. **Button Rows:** Max 3 buttons per row on mobile
2. **Select Menus:** Always on own row (full width)
3. **Modal Fields:** Stack vertically, max 2 per row
4. **Embeds:** Single-column layout, no side-by-side fields

### Touch Targets

- **Minimum size:** 44px × 44px (Discord default)
- **Button width:** Auto-stretch to 100% of message width
- **Spacing:** 8px padding between interactive elements

### Mobile Testing Checklist

- [ ] Test on iOS Discord app (screen tap sensitivity)
- [ ] Test on Android Discord app (button responsiveness)
- [ ] Verify modal keyboard doesn't overlap input
- [ ] Check select menu dropdown size on small screens
- [ ] Verify long card names truncate gracefully
- [ ] Test with slow internet (defer replies appropriately)

---

## Error Handling & Edge Cases

### Common Scenarios

| Scenario | Behavior |
|----------|----------|
| **Cooldown active** | Show timer, disable button, ephemeral warning |
| **Insufficient shards** | Show deficit, suggest earning methods, link to `/daily` |
| **Item no longer owned** | Graceful error, refresh inventory display |
| **Trade partner offline** | Warning but allow proposal (24h expiry) |
| **Component interaction timeout** | Disable components, offer to restart |
| **Concurrent action conflict** | Optimistic lock with retry button |

### Message State Management

```typescript
// Each component interaction should:
1. Defer reply (ephemeral if appropriate)
2. Fetch fresh data
3. Build response
4. Edit original reply (or create new message if needed)
5. Set appropriate timeout (5 min for interactive, 10s for feedback)

// Example:
await interaction.deferUpdate();
const freshData = await getUserCollection(guildId, userId);
const embed = buildEmbed(freshData);
const components = buildComponents(freshData);
await interaction.editReply({ embeds: [embed], components });
```

---

## Migration Path

### Phase A: Backwards Compatibility (Weeks 1-3)
- Keep all slash commands working
- Add component-based alternatives alongside
- Document both paths in `/help`

### Phase B: Feature Parity (Weeks 3-5)
- Ensure 100% feature coverage in new components
- Mirror all options (e.g., `shiny:true` available in modal)
- Performance testing + optimization

### Phase C: Gradual Migration (Weeks 5-7)
- Deprecate text-heavy slash commands
- Suggest new component flows when slash commands used
- Monitor usage analytics

### Phase D: Cleanup (Post-Week 7)
- Remove deprecated slash commands
- Archive old command handlers
- Update documentation

---

## Performance Considerations

### Interaction Latency Goals
- SelectMenu changes: < 500ms
- Button actions: < 1s
- Modal submission: < 2s
- Component render: Always < 3s

### Optimization Strategies
1. **Eager loading:** Pre-fetch collection on entry
2. **Caching:** 30s in-memory cache for collection/settings
3. **Lazy loading:** Load card details on-demand (not in list)
4. **Batch operations:** Combine DB queries where possible

### Rate Limiting
- Component interactions: 1 per second per user
- Modal submissions: 1 per 2 seconds per user
- Concurrent actions: Max 3 concurrent per user

---

## Accessibility

### Screen Reader Support
- All buttons have descriptive labels (not just emojis)
- Select menu options have clear descriptions
- Embed content readable top-to-bottom
- No conveying info via color alone

### Keyboard Navigation
- Tab through all interactive elements
- Enter to activate buttons
- Arrow keys for select menus

### High Contrast
- Embed colors pass WCAG AA standards
- Error states clearly marked (not just red)
- Text shadow on emojis for readability

---

## Documentation for Users

### In-Game Help Menu
```
🎴 DN Cards Component Guide

📂 Navigation
• Use dropdowns (▼) to pick categories
• Buttons do actions instantly
• Modals (forms) appear for complex input

🎴 Collection
1. Run /collection
2. Pick a rarity from dropdown
3. Pick a card to see details
4. Use action buttons (Burn, Trade, View)

📦 Packs
1. Run /packs
2. Click a tier button
3. Confirm to open

🤝 Trading
1. Run /trade
2. Select a friend
3. Fill in offer/want modals
4. Confirm trade

💡 Tips
• All interactions work on mobile
• Components expire after 5 minutes
• Use buttons instead of typing commands
```

---

## Success Metrics

### Engagement
- [ ] 40% increase in daily active users
- [ ] 50% reduction in command typos/errors
- [ ] 30% improvement in new user retention

### UX
- [ ] < 5s average interaction time
- [ ] 95% mobile compatibility
- [ ] 90% user satisfaction (poll after try)

### Performance
- [ ] < 500ms component response time
- [ ] < 2% error rate on interactions
- [ ] < 100ms DB queries per interaction

---

## Future Enhancements

### Post-Phase 1 Ideas
1. **Favorites system** — star cards to quick-access
2. **Quick-burn menu** — burn duplicates without modals
3. **Trade history timeline** — visual trade graph
4. **Card presets** — save commonly burned cards
5. **Notifications** — DM alerts for trade responses
6. **Comparison tool** — side-by-side card stats
7. **Wishlist integration** — spawn notifications with card browser
8. **Achievement showcase** — display in profile
9. **Leaderboard sorting** — multiple sort options
10. **Card rarity filters** — combined rarity + limited searches

---

## References

### Discord.js Documentation
- [Buttons](https://discordjs.guide/interactions/buttons.html)
- [Select Menus](https://discordjs.guide/interactions/select-menus.html)
- [Modals](https://discordjs.guide/interactions/modals.html)

### Design Inspiration
- Roblox Inventory System (grid layout, quick-access menus)
- Discord.js app examples (component routing patterns)
- Pokémon GO mobile UI (minimal text, icon-driven)
- TCG Arena digital interface (card browsing, rarity filters)

---

**Next Steps:**
1. Review this document with the team
2. Approve Phase 1-2 architecture
3. Begin component handler implementation
4. Set up testing framework for components
5. Plan mobile testing sessions
