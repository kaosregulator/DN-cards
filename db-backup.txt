--
-- PostgreSQL database dump
--

\restrict jFbcF8LpTFXfceGg7cYXaXmUSnPejdq140Q5rQcWVOduh6QZonTYpPRNgMrdWyk

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: card_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.card_type AS ENUM (
    'tank',
    'aircraft',
    'ship',
    'vehicle',
    'infantry',
    'boss',
    'community',
    'event',
    'achievement',
    'limited'
);


--
-- Name: rarity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rarity AS ENUM (
    'common',
    'uncommon',
    'rare',
    'epic',
    'legendary'
);


--
-- Name: trade_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trade_status AS ENUM (
    'pending',
    'accepted',
    'declined',
    'cancelled',
    'expired'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: achievements_unlocked; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievements_unlocked (
    id integer NOT NULL,
    guild_id text NOT NULL,
    user_id text NOT NULL,
    achievement_key text NOT NULL,
    unlocked_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: achievements_unlocked_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.achievements_unlocked_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: achievements_unlocked_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.achievements_unlocked_id_seq OWNED BY public.achievements_unlocked.id;


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id integer NOT NULL,
    guild_id text NOT NULL,
    user_id text NOT NULL,
    added_at timestamp without time zone DEFAULT now() NOT NULL,
    added_by text NOT NULL
);


--
-- Name: admin_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_users_id_seq OWNED BY public.admin_users.id;


--
-- Name: card_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_events (
    id integer NOT NULL,
    guild_id text NOT NULL,
    card_id integer NOT NULL,
    weight_multiplier real DEFAULT 2 NOT NULL,
    starts_at timestamp without time zone DEFAULT now() NOT NULL,
    ends_at timestamp without time zone NOT NULL,
    created_by text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: card_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.card_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: card_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.card_events_id_seq OWNED BY public.card_events.id;


--
-- Name: cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cards (
    id integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    rarity public.rarity NOT NULL,
    drop_weight real DEFAULT 1 NOT NULL,
    image_url text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    card_type public.card_type DEFAULT 'vehicle'::public.card_type NOT NULL,
    worth_value integer DEFAULT 10 NOT NULL,
    burn_value integer DEFAULT 5 NOT NULL,
    is_limited_edition boolean DEFAULT false NOT NULL,
    is_event_exclusive boolean DEFAULT false NOT NULL,
    max_copies integer,
    total_minted integer DEFAULT 0 NOT NULL,
    flavor text,
    droppable boolean DEFAULT true NOT NULL,
    set_name text,
    in_packs boolean DEFAULT true NOT NULL,
    is_archived boolean DEFAULT false NOT NULL
);


--
-- Name: cards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cards_id_seq OWNED BY public.cards.id;


--
-- Name: collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collections (
    id integer NOT NULL,
    guild_id text NOT NULL,
    user_id text NOT NULL,
    card_id integer NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    first_caught_at timestamp without time zone DEFAULT now() NOT NULL,
    last_caught_at timestamp without time zone DEFAULT now() NOT NULL,
    shiny_count integer DEFAULT 0 NOT NULL
);


--
-- Name: collections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.collections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: collections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.collections_id_seq OWNED BY public.collections.id;


--
-- Name: daily_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_claims (
    id integer NOT NULL,
    guild_id text NOT NULL,
    user_id text NOT NULL,
    last_claimed_at timestamp without time zone DEFAULT now() NOT NULL,
    streak integer DEFAULT 0 NOT NULL
);


--
-- Name: daily_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_claims_id_seq OWNED BY public.daily_claims.id;


--
-- Name: dashboard_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_users (
    id integer NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    is_owner boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    last_login_at timestamp without time zone
);


--
-- Name: dashboard_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dashboard_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dashboard_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dashboard_users_id_seq OWNED BY public.dashboard_users.id;


--
-- Name: embed_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embed_overrides (
    id integer NOT NULL,
    guild_id text NOT NULL,
    embed_key text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_by text
);


--
-- Name: embed_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.embed_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: embed_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.embed_overrides_id_seq OWNED BY public.embed_overrides.id;


--
-- Name: guild_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guild_settings (
    id integer NOT NULL,
    guild_id text NOT NULL,
    spawn_channel_id text,
    spawn_interval_seconds integer DEFAULT 3600 NOT NULL,
    spawn_interval_min integer,
    spawn_interval_max integer,
    use_random_interval boolean DEFAULT false NOT NULL,
    spawn_enabled boolean DEFAULT true NOT NULL,
    catch_window_seconds integer DEFAULT 120 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    trade_channel_id text,
    trade_enabled boolean DEFAULT true NOT NULL,
    cards_per_spawn integer DEFAULT 1 NOT NULL,
    rarity_weight_common integer,
    rarity_weight_uncommon integer,
    rarity_weight_rare integer,
    rarity_weight_epic integer,
    rarity_weight_legendary integer,
    catch_mode text DEFAULT 'type'::text NOT NULL,
    pack_cooldown_seconds integer DEFAULT 60 NOT NULL,
    pack_basic_cost integer DEFAULT 250 NOT NULL,
    pack_basic_size integer DEFAULT 5 NOT NULL,
    pack_basic_weekly_limit integer DEFAULT 50 NOT NULL,
    pack_premium_cost integer DEFAULT 750 NOT NULL,
    pack_premium_size integer DEFAULT 5 NOT NULL,
    pack_premium_weekly_limit integer DEFAULT 20 NOT NULL,
    pack_legendary_cost integer DEFAULT 2000 NOT NULL,
    pack_legendary_size integer DEFAULT 5 NOT NULL,
    pack_legendary_weekly_limit integer DEFAULT 5 NOT NULL
);


--
-- Name: guild_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guild_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guild_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.guild_settings_id_seq OWNED BY public.guild_settings.id;


--
-- Name: setup_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.setup_tokens (
    id integer NOT NULL,
    token text NOT NULL,
    issued_to_discord_id text NOT NULL,
    guild_id text,
    reset_for_user_id integer,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: setup_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.setup_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: setup_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.setup_tokens_id_seq OWNED BY public.setup_tokens.id;


--
-- Name: spawn_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spawn_log (
    id integer NOT NULL,
    guild_id text NOT NULL,
    channel_id text NOT NULL,
    card_id integer NOT NULL,
    caught_by text,
    is_forced boolean DEFAULT false NOT NULL,
    spawned_at timestamp without time zone DEFAULT now() NOT NULL,
    caught_at timestamp without time zone
);


--
-- Name: spawn_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spawn_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spawn_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.spawn_log_id_seq OWNED BY public.spawn_log.id;


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id integer NOT NULL,
    guild_id text NOT NULL,
    initiator_id text NOT NULL,
    target_id text NOT NULL,
    offered_card_id integer,
    requested_card_id integer,
    status public.trade_status DEFAULT 'pending'::public.trade_status NOT NULL,
    message_id text,
    channel_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone,
    offered_shards integer DEFAULT 0 NOT NULL,
    requested_shards integer DEFAULT 0 NOT NULL
);


--
-- Name: trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trades_id_seq OWNED BY public.trades.id;


--
-- Name: user_currency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_currency (
    id integer NOT NULL,
    guild_id text NOT NULL,
    user_id text NOT NULL,
    shards integer DEFAULT 0 NOT NULL,
    total_earned integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    packs_opened integer DEFAULT 0 NOT NULL,
    cards_burned integer DEFAULT 0 NOT NULL,
    packs_basic_week integer DEFAULT 0 NOT NULL,
    packs_premium_week integer DEFAULT 0 NOT NULL,
    packs_legendary_week integer DEFAULT 0 NOT NULL,
    packs_week_reset_at timestamp without time zone DEFAULT now() NOT NULL,
    last_pack_opened_at timestamp without time zone
);


--
-- Name: user_currency_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_currency_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_currency_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_currency_id_seq OWNED BY public.user_currency.id;


--
-- Name: user_timeouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_timeouts (
    id integer NOT NULL,
    guild_id text NOT NULL,
    user_id text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    reason text,
    issued_by text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: user_timeouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_timeouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_timeouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_timeouts_id_seq OWNED BY public.user_timeouts.id;


--
-- Name: wishlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wishlists (
    id integer NOT NULL,
    guild_id text NOT NULL,
    user_id text NOT NULL,
    card_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: wishlists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wishlists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wishlists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wishlists_id_seq OWNED BY public.wishlists.id;


--
-- Name: achievements_unlocked id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements_unlocked ALTER COLUMN id SET DEFAULT nextval('public.achievements_unlocked_id_seq'::regclass);


--
-- Name: admin_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users ALTER COLUMN id SET DEFAULT nextval('public.admin_users_id_seq'::regclass);


--
-- Name: card_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_events ALTER COLUMN id SET DEFAULT nextval('public.card_events_id_seq'::regclass);


--
-- Name: cards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards ALTER COLUMN id SET DEFAULT nextval('public.cards_id_seq'::regclass);


--
-- Name: collections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections ALTER COLUMN id SET DEFAULT nextval('public.collections_id_seq'::regclass);


--
-- Name: daily_claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_claims ALTER COLUMN id SET DEFAULT nextval('public.daily_claims_id_seq'::regclass);


--
-- Name: dashboard_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users ALTER COLUMN id SET DEFAULT nextval('public.dashboard_users_id_seq'::regclass);


--
-- Name: embed_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embed_overrides ALTER COLUMN id SET DEFAULT nextval('public.embed_overrides_id_seq'::regclass);


--
-- Name: guild_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guild_settings ALTER COLUMN id SET DEFAULT nextval('public.guild_settings_id_seq'::regclass);


--
-- Name: setup_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setup_tokens ALTER COLUMN id SET DEFAULT nextval('public.setup_tokens_id_seq'::regclass);


--
-- Name: spawn_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spawn_log ALTER COLUMN id SET DEFAULT nextval('public.spawn_log_id_seq'::regclass);


--
-- Name: trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades ALTER COLUMN id SET DEFAULT nextval('public.trades_id_seq'::regclass);


--
-- Name: user_currency id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_currency ALTER COLUMN id SET DEFAULT nextval('public.user_currency_id_seq'::regclass);


--
-- Name: user_timeouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_timeouts ALTER COLUMN id SET DEFAULT nextval('public.user_timeouts_id_seq'::regclass);


--
-- Name: wishlists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists ALTER COLUMN id SET DEFAULT nextval('public.wishlists_id_seq'::regclass);


--
-- Data for Name: achievements_unlocked; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.achievements_unlocked (id, guild_id, user_id, achievement_key, unlocked_at) FROM stdin;
1	1480402385821110292	1211353501909786749	first_catch	2026-05-24 03:34:38.840587
2	1480402385821110292	1211353501909786749	rookie	2026-05-24 06:23:31.124502
\.


--
-- Data for Name: admin_users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_users (id, guild_id, user_id, added_at, added_by) FROM stdin;
\.


--
-- Data for Name: card_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.card_events (id, guild_id, card_id, weight_multiplier, starts_at, ends_at, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: cards; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cards (id, name, description, rarity, drop_weight, image_url, created_at, card_type, worth_value, burn_value, is_limited_edition, is_event_exclusive, max_copies, total_minted, flavor, droppable, set_name, in_packs, is_archived) FROM stdin;
261	Master Helstorm		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/master_helstorm_00018108.png	2026-05-24 03:16:29.983277	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
292	RPG Soldier		common	60	https://misu.nephbox.net/card_image/1363917781355069761/rpg_soldier_00018139.png	2026-05-24 03:16:30.225854	vehicle	20	10	f	f	\N	3	\N	t	master	t	f
263	BGW		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/bgw_00018110.png	2026-05-24 03:16:30.002072	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
264	SX59		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/sx59_00018111.png	2026-05-24 03:16:30.009114	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
265	Master Reaper		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/master_reaper_00018112.png	2026-05-24 03:16:30.016753	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
289	Vault Raider		common	60	https://misu.nephbox.net/card_image/1363917781355069761/vault_raider_00018136.png	2026-05-24 03:16:30.194634	vehicle	20	10	f	f	\N	1	\N	t	master	t	f
274	Abrams X		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/abrams_x_00018121.png	2026-05-24 03:16:30.083686	vehicle	50	25	f	f	\N	1	\N	t	master	t	f
267	SB21		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/sb21_00018114.png	2026-05-24 03:16:30.0314	vehicle	3000	1500	f	f	\N	1	\N	t	master	t	f
287	BOSS Soldier		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/boss_soldier_00018134.png	2026-05-24 03:16:30.179736	vehicle	50	25	f	f	\N	1	\N	t	master	t	f
275	T90		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/t90_00018122.png	2026-05-24 03:16:30.090863	vehicle	50	25	f	f	\N	1	\N	t	master	t	f
271	Weiner Wagon		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/weiner_wagon_00018118.png	2026-05-24 03:16:30.060964	vehicle	50	25	f	f	\N	0	\N	t	master	t	f
262	G-Bis		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/g-bis_00018109.png	2026-05-24 03:16:29.993657	vehicle	3000	1500	f	f	\N	3	\N	t	master	t	f
280	RATTE		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/ratte_00018127.png	2026-05-24 03:16:30.126828	vehicle	3000	1500	f	f	\N	1	\N	t	master	t	f
286	Elite Soldier		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/elite_soldier_00018133.png	2026-05-24 03:16:30.172249	vehicle	50	25	f	f	\N	3	\N	t	master	t	f
278	Biplane		common	60	https://misu.nephbox.net/card_image/1363917781355069761/biplane_00018125.jpg	2026-05-24 03:16:30.112205	vehicle	20	10	f	f	\N	5	\N	t	master	t	f
276	Volk		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/volk_00018123.png	2026-05-24 03:16:30.097407	vehicle	50	25	f	f	\N	0	\N	t	master	t	f
270	ATV		common	60	https://misu.nephbox.net/card_image/1363917781355069761/atv_00018117.jpg	2026-05-24 03:16:30.05293	vehicle	20	10	f	f	\N	1	\N	t	master	t	f
284	Juggernaut		common	60	https://misu.nephbox.net/card_image/1363917781355069761/18131.png	2026-05-24 03:16:30.156403	vehicle	20	10	f	f	\N	3	\N	t	master	t	f
279	Haunted Tank		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/haunted_tank_00018126.png	2026-05-24 03:16:30.120034	vehicle	3000	1500	f	f	\N	0	\N	t	master	t	f
290	Toxic Trooper		common	60	https://misu.nephbox.net/card_image/1363917781355069761/toxic_trooper_00018137.png	2026-05-24 03:16:30.210939	vehicle	20	10	f	f	\N	3	\N	t	master	t	f
281	Super AN Jeep		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/super_an_jeep_00018128.png	2026-05-24 03:16:30.134513	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
282	Mother ship		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/mother_ship_00018129.png	2026-05-24 03:16:30.141964	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
283	BOSS Sea Tank		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/boss_sea_tank_00018130.png	2026-05-24 03:16:30.148964	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
266	SB-12		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/sb-12_00018113.png	2026-05-24 03:16:30.024105	vehicle	3000	1500	f	f	\N	1	\N	t	master	t	f
273	Calzone Cannon		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/calzone_cannon_00018120.png	2026-05-24 03:16:30.077081	vehicle	50	25	f	f	\N	3	\N	t	master	t	f
297	Naval Officer		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/9f4c3ae2117d414d91794eaffda0b0b9.png	2026-05-24 03:16:30.266743	vehicle	50	25	f	f	\N	2	\N	t	master	t	f
288	Golden Soldier		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/golden_soldier_00018135.png	2026-05-24 03:16:30.186993	vehicle	50	25	f	f	\N	0	\N	t	master	t	f
285	Hacker Soldier		common	60	https://misu.nephbox.net/card_image/1363917781355069761/hacker_soldier_00018132.png	2026-05-24 03:16:30.164609	vehicle	20	10	f	f	\N	6	\N	t	master	t	f
272	Assault Bike		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/assault_bike_00018119.png	2026-05-24 03:16:30.068236	vehicle	50	25	f	f	\N	1	\N	t	master	t	f
268	Armored Jeep		common	60	https://misu.nephbox.net/card_image/1363917781355069761/armored_jeep_00018115.jpg	2026-05-24 03:16:30.038272	vehicle	20	10	f	f	\N	3	\N	t	master	t	f
277	Chinook		common	60	https://misu.nephbox.net/card_image/1363917781355069761/chinook_00018124.jpg	2026-05-24 03:16:30.104633	vehicle	20	10	f	f	\N	4	\N	t	master	t	f
293	LEBB		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/fe1f2d45cb1447a2829d21d5dd694d2d.png	2026-05-24 03:16:30.238097	vehicle	3000	1500	f	f	\N	0	\N	t	master	t	f
294	Gold Typhoon		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/121bb44e38354e00a42f2e388b8bb412.png	2026-05-24 03:16:30.245189	vehicle	5000	2500	f	f	\N	0	\N	t	master	t	f
295	The Apocalypse		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/b9c1a86ef92a40f285a0fb1421a30e22.png	2026-05-24 03:16:30.253014	vehicle	5000	2500	f	f	\N	0	\N	t	master	t	f
296	Super Keiler		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/e21beb1e2b1749a6b0c1a935778358a9.png	2026-05-24 03:16:30.259548	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
291	Railgun Killer		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/railgun_killer_00018138.png	2026-05-24 03:16:30.217748	vehicle	50	25	f	f	\N	2	\N	t	master	t	f
298	Marine Soilder	An amphibious infantry unit armed with an AUG and flashbang. Blinds enemies, disrupts their vision, and creates openings for teammates to attack.	uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/1fa40c3562da49398246b1f92c8d0be7.png	2026-05-24 03:16:30.273351	vehicle	50	25	f	f	\N	0	\N	t	master	t	f
299	Assassin		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/5df0962379ae4ce9b06d2a336a7cfba3.png	2026-05-24 03:16:30.280267	infantry	50	25	f	f	\N	1	\N	t	master	t	f
300	Nuke F35		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/c32ede043d9849de9a9d8b07821a1ba7.png	2026-05-24 03:16:30.286982	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
269	Logistics Truck		common	60	https://misu.nephbox.net/card_image/1363917781355069761/logistics_truck_00018116.jpg	2026-05-24 03:16:30.045721	vehicle	20	10	f	f	\N	6	\N	t	master	t	f
308	Mech Walker		epic	4	https://misu.nephbox.net/card_image/1363917781355069761/26d6264d9003474a845c9daa24e9a8dc.png	2026-05-24 03:16:30.343689	vehicle	2000	1000	f	f	\N	1	\N	t	master	t	f
303	SA50		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/08108c02d7724998a275539f8b6e6e3d.png	2026-05-24 03:16:30.308928	vehicle	3000	1500	f	f	\N	0	\N	t	master	t	f
306	Puckmonster		epic	4	https://misu.nephbox.net/card_image/1363917781355069761/c45747e7de2049efa4d05dc1106b9056.png	2026-05-24 03:16:30.328902	vehicle	1480	740	f	f	\N	0	\N	t	master	t	f
307	Nuke Sniper Animated		epic	4	https://misu.nephbox.net/card_image/1363917781355069761/3a6052e7dec349e7be0ce9d5bd174e7b.gif	2026-05-24 03:16:30.336238	vehicle	1480	740	f	f	\N	0	\N	t	master	t	f
309	Platinum Mech		epic	4	https://misu.nephbox.net/card_image/1363917781355069761/785aa2867d83457aab48c235de0dcbfd.png	2026-05-24 03:16:30.352492	vehicle	2000	1000	f	f	\N	0	\N	t	master	t	f
310	STM		epic	4	https://misu.nephbox.net/card_image/1363917781355069761/07dabfbdb06d4e30b7c9ace7196cefd8.png	2026-05-24 03:16:30.35914	vehicle	2000	1000	f	f	\N	0	\N	t	master	t	f
311	STT		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/6337be0ec09f46c6bb58172dd5dbca4f.png	2026-05-24 03:16:30.366428	vehicle	3000	1500	f	f	\N	0	\N	t	master	t	f
312	Nuke Sub		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/831c1e58287547f385523e99f4fc9bfa.png	2026-05-24 03:16:30.373475	vehicle	2500	1250	f	f	\N	0	\N	t	master	t	f
313	Le Bismarck		legendary	1	https://misu.nephbox.net/card_image/1363917781355069761/cecd41970a5e493cbd17c5a3fb1cf525.png	2026-05-24 03:16:30.3804	vehicle	800	400	f	f	\N	0	\N	t	master	t	f
304	NMT		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/d80c273e5676436faddc017f46a83690.png	2026-05-24 03:16:30.3158	vehicle	3000	1500	f	f	\N	2	\N	t	master	t	f
302	Blackhawk Trooper		uncommon	25	https://misu.nephbox.net/card_image/1363917781355069761/3dc888636536437293a845efd438aafe.png	2026-05-24 03:16:30.301266	vehicle	50	25	f	f	\N	2	\N	t	master	t	f
301	Artillery Truck		common	60	https://misu.nephbox.net/card_image/1363917781355069761/e4d6b06b7b384831ac2d4c1542b75563.jpg	2026-05-24 03:16:30.294268	vehicle	20	10	f	f	\N	3	\N	t	master	t	f
305	Nuke Sniper		epic	4	https://misu.nephbox.net/card_image/1363917781355069761/27720dd43de44547a1024d9110d57347.png	2026-05-24 03:16:30.322389	vehicle	1480	740	f	f	\N	1	\N	t	master	t	f
314	LE A-10		rare	10	https://misu.nephbox.net/card_image/1363917781355069761/2261f18589ec4d3fb8b151fcd303fa8b.png	2026-05-24 03:16:30.387111	vehicle	3000	1500	f	f	\N	2	\N	t	master	t	f
\.


--
-- Data for Name: collections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.collections (id, guild_id, user_id, card_id, count, first_caught_at, last_caught_at, shiny_count) FROM stdin;
9	1480402385821110292	1211353501909786749	289	1	2026-05-24 03:35:21.194931	2026-05-24 03:35:21.194931	0
8	1480402385821110292	1211353501909786749	292	2	2026-05-24 03:35:21.18003	2026-05-25 03:11:36.15	0
16	1480402385821110292	1211353501909786749	270	1	2026-05-24 06:50:59.026512	2026-05-24 06:50:59.026512	0
17	1480402385821110292	1211353501909786749	275	1	2026-05-24 06:51:13.371009	2026-05-24 06:51:13.371009	0
29	1480402385821110292	1211353501909786749	297	2	2026-05-24 23:01:24.102933	2026-05-25 03:11:41.3	0
11	1480402385821110292	1211353501909786749	304	2	2026-05-24 04:29:21.442099	2026-05-24 07:43:38.135	0
20	1480402385821110292	1211353501909786749	302	2	2026-05-24 07:43:38.112613	2026-05-24 07:56:21.658	0
12	1480402385821110292	1211353501909786749	284	2	2026-05-24 04:29:50.021059	2026-05-24 08:35:49.344	0
22	1480402385821110292	1037737554641961030	262	1	2026-05-24 08:49:30.131446	2026-05-24 08:49:30.131446	0
24	1480402385821110292	1211353501909786749	272	1	2026-05-24 22:11:37.964564	2026-05-24 22:11:37.964564	0
14	1480402385821110292	1211353501909786749	262	2	2026-05-24 05:58:09.187581	2026-05-24 23:01:18.942	0
18	1480402385821110292	1211353501909786749	291	1	2026-05-24 07:42:59.487094	2026-05-24 23:21:52.303	0
25	1480402385821110292	1211353501909786749	273	2	2026-05-24 22:26:21.739216	2026-05-24 23:22:50.681	0
38	1480402385821110292	1211353501909786749	301	2	2026-05-24 23:22:50.673673	2026-05-24 23:22:50.687	0
7	1480402385821110292	1211353501909786749	268	3	2026-05-24 03:35:21.172725	2026-05-24 23:22:50.7	0
5	1480402385821110292	1211353501909786749	285	6	2026-05-24 03:34:49.449361	2026-05-24 23:23:15.633	0
13	1480402385821110292	1211353501909786749	269	6	2026-05-24 04:30:17.490752	2026-05-24 23:23:15.64	0
15	1480402385821110292	1211353501909786749	277	4	2026-05-24 06:23:30.336666	2026-05-24 23:23:15.646	0
10	1480402385821110292	1211353501909786749	290	2	2026-05-24 03:35:21.201851	2026-05-24 23:23:15.651	0
21	1480402385821110292	1211353501909786749	278	4	2026-05-24 07:43:38.11865	2026-05-25 00:12:34.791	0
49	1480402385821110292	1211353501909786749	287	1	2026-05-25 01:09:24.69502	2026-05-25 01:09:24.69502	0
51	1480402385821110292	1211353501909786749	267	1	2026-05-25 01:09:48.604349	2026-05-25 01:09:48.604349	0
52	1480402385821110292	1211353501909786749	274	1	2026-05-25 02:21:19.745544	2026-05-25 02:21:19.745544	0
53	1480402385821110292	1211353501909786749	305	1	2026-05-25 02:21:19.760949	2026-05-25 02:21:19.760949	0
19	1480402385821110292	1211353501909786749	286	3	2026-05-24 07:43:09.042198	2026-05-25 02:21:19.77	0
35	1480402385821110292	1211353501909786749	314	2	2026-05-24 23:22:35.507373	2026-05-25 02:21:19.777	0
56	1480402385821110292	1211353501909786749	308	1	2026-05-25 02:21:19.784114	2026-05-25 02:21:19.784114	0
\.


--
-- Data for Name: daily_claims; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.daily_claims (id, guild_id, user_id, last_claimed_at, streak) FROM stdin;
1	1480402385821110292	1211353501909786749	2026-05-24 03:36:06.426	1
\.


--
-- Data for Name: dashboard_users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dashboard_users (id, username, password_hash, is_owner, created_at, last_login_at) FROM stdin;
4	kaos	$2b$10$mMQ9JtMRAfn2mMagrnzu/uxLaCGynga8g3An4l/4MCuv40YVMdiSe	t	2026-05-25 02:06:36.025248	\N
\.


--
-- Data for Name: embed_overrides; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.embed_overrides (id, guild_id, embed_key, config, updated_at, updated_by) FROM stdin;
\.


--
-- Data for Name: guild_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.guild_settings (id, guild_id, spawn_channel_id, spawn_interval_seconds, spawn_interval_min, spawn_interval_max, use_random_interval, spawn_enabled, catch_window_seconds, updated_at, trade_channel_id, trade_enabled, cards_per_spawn, rarity_weight_common, rarity_weight_uncommon, rarity_weight_rare, rarity_weight_epic, rarity_weight_legendary, catch_mode, pack_cooldown_seconds, pack_basic_cost, pack_basic_size, pack_basic_weekly_limit, pack_premium_cost, pack_premium_size, pack_premium_weekly_limit, pack_legendary_cost, pack_legendary_size, pack_legendary_weekly_limit) FROM stdin;
1	1480402385821110292	1501015789656997909	300	\N	\N	f	t	30	2026-05-24 22:24:11.77	\N	t	3	\N	\N	\N	\N	\N	button	60	250	5	50	750	5	20	2000	5	5
\.


--
-- Data for Name: setup_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.setup_tokens (id, token, issued_to_discord_id, guild_id, reset_for_user_id, expires_at, used_at, created_at) FROM stdin;
4	98QSskRFeZOCR2tQGM5rxzPsK29vAkOz	1211353501909786749	1480402385821110292	\N	2026-05-26 02:05:56.201	2026-05-25 02:06:35.945	2026-05-25 02:05:56.210763
5	Fun092GJcsOAuslauhOs0iXnws2ZCGn5	web:kaos	\N	\N	2026-05-26 02:08:05.145	\N	2026-05-25 02:08:05.146478
\.


--
-- Data for Name: spawn_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.spawn_log (id, guild_id, channel_id, card_id, caught_by, is_forced, spawned_at, caught_at) FROM stdin;
68	1480402385821110292	1501015789656997909	276	\N	f	2026-05-24 03:23:57.423058	\N
69	1480402385821110292	1501015789656997909	278	1211353501909786749	f	2026-05-24 03:34:29.119842	2026-05-24 03:34:37.874
70	1480402385821110292	1501015789656997909	285	1211353501909786749	f	2026-05-24 03:34:34.467898	2026-05-24 03:34:49.455
71	1480402385821110292	1501015789656997909	266	1211353501909786749	f	2026-05-24 03:34:39.756202	2026-05-24 03:35:08.516
72	1480402385821110292	1501015789656997909	314	\N	f	2026-05-24 03:39:40.038137	\N
73	1480402385821110292	1501015789656997909	277	\N	f	2026-05-24 03:39:45.301787	\N
74	1480402385821110292	1501015789656997909	273	\N	f	2026-05-24 03:39:50.572098	\N
75	1480402385821110292	1501015789656997909	297	\N	f	2026-05-24 03:48:56.603069	\N
76	1480402385821110292	1501015789656997909	284	\N	f	2026-05-24 03:49:01.893632	\N
77	1480402385821110292	1501015789656997909	298	\N	f	2026-05-24 03:49:07.164214	\N
78	1480402385821110292	1501015789656997909	307	\N	f	2026-05-24 03:54:07.43301	\N
79	1480402385821110292	1501015789656997909	302	\N	f	2026-05-24 03:54:12.866547	\N
80	1480402385821110292	1501015789656997909	292	\N	f	2026-05-24 03:54:18.230927	\N
81	1480402385821110292	1501015789656997909	268	\N	f	2026-05-24 04:00:19.914216	\N
82	1480402385821110292	1501015789656997909	272	\N	f	2026-05-24 04:05:20.427968	\N
83	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 04:10:20.768178	\N
84	1480402385821110292	1501015789656997909	311	\N	f	2026-05-24 04:10:26.0783	\N
85	1480402385821110292	1501015789656997909	268	\N	f	2026-05-24 04:10:31.33306	\N
86	1480402385821110292	1501015789656997909	304	1211353501909786749	f	2026-05-24 04:29:13.7184	2026-05-24 04:29:21.45
88	1480402385821110292	1501015789656997909	284	1211353501909786749	f	2026-05-24 04:29:24.238557	2026-05-24 04:29:50.028
87	1480402385821110292	1501015789656997909	269	1211353501909786749	f	2026-05-24 04:29:18.992292	2026-05-24 04:30:17.499
89	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 04:34:24.535827	\N
90	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 04:39:24.954534	\N
91	1480402385821110292	1501015789656997909	276	\N	f	2026-05-24 04:39:30.331526	\N
92	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 04:44:30.613383	\N
93	1480402385821110292	1501015789656997909	271	\N	f	2026-05-24 04:44:35.961774	\N
94	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 04:49:36.238827	\N
95	1480402385821110292	1501015789656997909	262	\N	f	2026-05-24 04:49:41.462081	\N
96	1480402385821110292	1501015789656997909	289	\N	f	2026-05-24 04:54:41.745289	\N
97	1480402385821110292	1501015789656997909	276	\N	f	2026-05-24 04:59:42.003555	\N
98	1480402385821110292	1501015789656997909	289	\N	f	2026-05-24 04:59:47.280558	\N
99	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 05:04:47.604548	\N
100	1480402385821110292	1501015789656997909	277	\N	f	2026-05-24 05:04:52.968294	\N
101	1480402385821110292	1501015789656997909	268	\N	f	2026-05-24 05:04:58.431775	\N
102	1480402385821110292	1501015789656997909	268	\N	f	2026-05-24 05:13:24.252057	\N
103	1480402385821110292	1501015789656997909	302	\N	f	2026-05-24 05:13:29.646192	\N
104	1480402385821110292	1501015789656997909	288	\N	f	2026-05-24 05:18:29.913448	\N
105	1480402385821110292	1501015789656997909	285	\N	f	2026-05-24 05:18:35.17978	\N
106	1480402385821110292	1501015789656997909	278	\N	f	2026-05-24 05:23:35.527801	\N
107	1480402385821110292	1501015789656997909	292	\N	f	2026-05-24 05:28:37.144824	\N
108	1480402385821110292	1501015789656997909	284	\N	f	2026-05-24 05:28:42.55422	\N
109	1480402385821110292	1501015789656997909	272	\N	f	2026-05-24 05:28:47.922554	\N
110	1480402385821110292	1501015789656997909	301	\N	f	2026-05-24 05:39:42.777263	\N
111	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 05:39:48.481063	\N
112	1480402385821110292	1501015789656997909	266	\N	f	2026-05-24 05:39:53.812854	\N
113	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 05:44:54.065935	\N
114	1480402385821110292	1501015789656997909	278	\N	f	2026-05-24 05:44:59.376894	\N
115	1480402385821110292	1501015789656997909	297	\N	f	2026-05-24 05:54:43.104556	\N
116	1480402385821110292	1501015789656997909	262	1211353501909786749	t	2026-05-24 05:57:59.389828	2026-05-24 05:58:09.196
117	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 06:06:07.720276	\N
118	1480402385821110292	1501015789656997909	278	\N	f	2026-05-24 06:06:13.005053	\N
119	1480402385821110292	1501015789656997909	269	1211353501909786749	f	2026-05-24 06:06:18.283548	2026-05-24 06:07:38.478
120	1480402385821110292	1501015789656997909	290	\N	f	2026-05-24 06:13:55.827208	\N
121	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 06:14:01.150403	\N
122	1480402385821110292	1501015789656997909	290	\N	f	2026-05-24 06:14:06.517443	\N
123	1480402385821110292	1501015789656997909	289	\N	f	2026-05-24 06:22:49.304817	\N
124	1480402385821110292	1501015789656997909	291	\N	f	2026-05-24 06:22:54.552434	\N
125	1480402385821110292	1501015789656997909	277	1211353501909786749	f	2026-05-24 06:22:59.838412	2026-05-24 06:23:30.345
126	1480402385821110292	1501015789656997909	285	\N	f	2026-05-24 06:28:00.136532	\N
127	1480402385821110292	1501015789656997909	272	\N	f	2026-05-24 06:28:05.426078	\N
128	1480402385821110292	1501015789656997909	284	\N	f	2026-05-24 06:33:29.829386	\N
129	1480402385821110292	1501015789656997909	298	\N	f	2026-05-24 06:33:35.227104	\N
131	1480402385821110292	1501015789656997909	270	1211353501909786749	f	2026-05-24 06:50:46.584625	2026-05-24 06:50:59.035
130	1480402385821110292	1501015789656997909	275	1211353501909786749	f	2026-05-24 06:50:41.142257	2026-05-24 06:51:13.378
132	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 06:55:46.901352	\N
133	1480402385821110292	1501015789656997909	293	\N	f	2026-05-24 06:55:52.231699	\N
134	1480402385821110292	1501015789656997909	271	\N	f	2026-05-24 06:55:57.486747	\N
135	1480402385821110292	1501015789656997909	273	\N	f	2026-05-24 07:00:57.779153	\N
136	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 07:30:29.846824	\N
137	1480402385821110292	1501015789656997909	275	\N	f	2026-05-24 07:30:35.113231	\N
138	1480402385821110292	1501015789656997909	289	\N	f	2026-05-24 07:30:40.403437	\N
139	1480402385821110292	1501015789656997909	289	\N	f	2026-05-24 07:37:50.823753	\N
140	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 07:37:56.121967	\N
141	1480402385821110292	1501015789656997909	291	1211353501909786749	f	2026-05-24 07:42:56.513218	2026-05-24 07:42:59.496
142	1480402385821110292	1501015789656997909	277	1211353501909786749	f	2026-05-24 07:43:01.861718	2026-05-24 07:43:03.958
143	1480402385821110292	1501015789656997909	286	1211353501909786749	f	2026-05-24 07:43:07.069123	2026-05-24 07:43:09.047
144	1480402385821110292	1501015789656997909	284	1211353501909786749	f	2026-05-24 07:56:08.451014	2026-05-24 07:56:13.379
146	1480402385821110292	1501015789656997909	302	1211353501909786749	f	2026-05-24 07:56:19.544476	2026-05-24 07:56:21.665
145	1480402385821110292	1501015789656997909	285	1211353501909786749	f	2026-05-24 07:56:14.282096	2026-05-24 07:56:48.049
147	1480402385821110292	1501015789656997909	303	\N	f	2026-05-24 08:01:19.799589	\N
148	1480402385821110292	1501015789656997909	273	\N	f	2026-05-24 08:28:19.842902	\N
149	1480402385821110292	1501015789656997909	292	\N	f	2026-05-24 08:28:25.222359	\N
150	1480402385821110292	1501015789656997909	284	1211353501909786749	f	2026-05-24 08:35:46.300206	2026-05-24 08:35:49.353
151	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 08:35:51.582806	\N
152	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 08:35:56.902799	\N
153	1480402385821110292	1501015789656997909	286	1211353501909786749	f	2026-05-24 08:46:31.84707	2026-05-24 08:46:39.576
154	1480402385821110292	1501015789656997909	299	1211353501909786749	f	2026-05-24 08:51:32.357008	2026-05-24 08:51:35.124
155	1480402385821110292	1501015789656997909	275	\N	f	2026-05-24 08:56:32.615964	\N
156	1480402385821110292	1501015789656997909	285	1211353501909786749	f	2026-05-24 09:01:33.013354	2026-05-24 09:01:42.784
157	1480402385821110292	1501015789656997909	286	\N	f	2026-05-24 09:06:33.322858	\N
158	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 09:11:33.648648	\N
159	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 09:16:34.020899	\N
192	1480402385821110292	1501015789656997909	292	\N	f	2026-05-24 09:24:49.072157	\N
193	1480402385821110292	1501015789656997909	277	\N	f	2026-05-24 09:29:49.506811	\N
194	1480402385821110292	1501015789656997909	274	\N	f	2026-05-24 19:25:08.45746	\N
195	1480402385821110292	1501015789656997909	277	\N	f	2026-05-24 19:30:08.895221	\N
228	1480402385821110292	1501015789656997909	268	\N	f	2026-05-24 21:28:34.252212	\N
229	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 21:33:34.928928	\N
230	1480402385821110292	1501015789656997909	292	\N	f	2026-05-24 21:38:35.172329	\N
231	1480402385821110292	1501015789656997909	292	\N	f	2026-05-24 21:47:02.082884	\N
232	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 22:06:35.079204	\N
233	1480402385821110292	1501015789656997909	272	1211353501909786749	f	2026-05-24 22:11:35.440046	2026-05-24 22:11:37.973
234	1480402385821110292	1501015789656997909	271	\N	f	2026-05-24 22:21:16.543095	\N
235	1480402385821110292	1501015789656997909	273	1211353501909786749	f	2026-05-24 22:26:16.979973	2026-05-24 22:26:21.774
236	1480402385821110292	1501015789656997909	280	1211353501909786749	f	2026-05-24 22:26:22.327245	2026-05-24 22:26:30.282
237	1480402385821110292	1501015789656997909	273	1211353501909786749	f	2026-05-24 22:26:27.638193	2026-05-24 22:26:33.773
238	1480402385821110292	1501015789656997909	284	\N	f	2026-05-24 22:40:46.574705	\N
239	1480402385821110292	1501015789656997909	277	\N	f	2026-05-24 22:40:51.885162	\N
240	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 22:40:57.269718	\N
241	1480402385821110292	1501015789656997909	292	\N	f	2026-05-24 22:45:57.534589	\N
242	1480402385821110292	1501015789656997909	277	\N	f	2026-05-24 22:46:02.800474	\N
243	1480402385821110292	1501015789656997909	278	\N	f	2026-05-24 22:46:08.068166	\N
244	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 22:56:05.598604	\N
245	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 22:56:10.949937	\N
246	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 22:56:16.200217	\N
247	1480402385821110292	1501015789656997909	262	1211353501909786749	f	2026-05-24 23:01:16.486328	2026-05-24 23:01:19.047
248	1480402385821110292	1501015789656997909	297	1211353501909786749	f	2026-05-24 23:01:21.819639	2026-05-24 23:01:24.114
249	1480402385821110292	1501015789656997909	285	\N	f	2026-05-24 23:01:27.192708	\N
250	1480402385821110292	1501015789656997909	292	\N	f	2026-05-24 23:06:27.423306	\N
251	1480402385821110292	1501015789656997909	268	\N	f	2026-05-24 23:06:32.781305	\N
252	1480402385821110292	1501015789656997909	278	\N	f	2026-05-24 23:06:38.089357	\N
253	1480402385821110292	1501015789656997909	278	\N	f	2026-05-24 23:16:38.141363	\N
254	1480402385821110292	1501015789656997909	310	\N	f	2026-05-24 23:16:43.454678	\N
255	1480402385821110292	1501015789656997909	277	\N	f	2026-05-24 23:16:48.773375	\N
256	1480402385821110292	1501015789656997909	291	1211353501909786749	f	2026-05-24 23:21:49.083523	2026-05-24 23:21:52.321
258	1480402385821110292	1501015789656997909	290	1211353501909786749	f	2026-05-24 23:21:59.615959	2026-05-24 23:22:01.733
257	1480402385821110292	1501015789656997909	301	1211353501909786749	f	2026-05-24 23:21:54.337368	2026-05-24 23:22:06.343
259	1480402385821110292	1501015789656997909	287	\N	f	2026-05-24 23:27:00.002331	\N
260	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 23:27:05.328202	\N
261	1480402385821110292	1501015789656997909	292	\N	f	2026-05-24 23:27:10.632153	\N
262	1480402385821110292	1501015789656997909	306	\N	f	2026-05-24 23:32:11.029573	\N
263	1480402385821110292	1501015789656997909	284	\N	f	2026-05-24 23:32:16.412538	\N
264	1480402385821110292	1501015789656997909	273	\N	f	2026-05-24 23:32:21.698582	\N
265	1480402385821110292	1501015789656997909	266	\N	f	2026-05-24 23:37:22.003622	\N
266	1480402385821110292	1501015789656997909	288	\N	f	2026-05-24 23:37:27.476153	\N
267	1480402385821110292	1501015789656997909	286	\N	f	2026-05-24 23:37:32.738409	\N
268	1480402385821110292	1501015789656997909	284	\N	f	2026-05-24 23:42:33.105569	\N
269	1480402385821110292	1501015789656997909	273	\N	f	2026-05-24 23:42:38.494303	\N
270	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 23:42:43.850641	\N
271	1480402385821110292	1501015789656997909	262	\N	f	2026-05-24 23:51:11.47101	\N
272	1480402385821110292	1501015789656997909	269	\N	f	2026-05-24 23:51:16.788285	\N
273	1480402385821110292	1501015789656997909	284	\N	f	2026-05-24 23:51:22.114734	\N
274	1480402385821110292	1501015789656997909	301	\N	f	2026-05-24 23:56:22.36547	\N
275	1480402385821110292	1501015789656997909	289	\N	f	2026-05-24 23:56:27.612146	\N
276	1480402385821110292	1501015789656997909	270	\N	f	2026-05-24 23:56:33.046621	\N
277	1480402385821110292	1501015789656997909	290	\N	f	2026-05-25 00:01:33.319882	\N
278	1480402385821110292	1501015789656997909	301	\N	f	2026-05-25 00:01:38.656803	\N
279	1480402385821110292	1501015789656997909	287	\N	f	2026-05-25 00:01:43.997586	\N
280	1480402385821110292	1501015789656997909	290	\N	f	2026-05-25 00:06:44.242982	\N
281	1480402385821110292	1501015789656997909	274	\N	f	2026-05-25 00:06:49.503432	\N
282	1480402385821110292	1501015789656997909	292	\N	f	2026-05-25 00:06:54.742205	\N
283	1480402385821110292	1501015789656997909	298	\N	f	2026-05-25 00:11:55.014151	\N
284	1480402385821110292	1501015789656997909	284	\N	f	2026-05-25 00:12:00.33247	\N
285	1480402385821110292	1501015789656997909	278	1211353501909786749	f	2026-05-25 00:12:07.328329	2026-05-25 00:12:34.8
286	1480402385821110292	1501015789656997909	299	\N	f	2026-05-25 00:21:45.893498	\N
287	1480402385821110292	1501015789656997909	284	\N	f	2026-05-25 00:21:51.282657	\N
288	1480402385821110292	1501015789656997909	290	\N	f	2026-05-25 00:21:56.576082	\N
289	1480402385821110292	1501015789656997909	293	\N	f	2026-05-25 00:26:56.882768	\N
290	1480402385821110292	1501015789656997909	262	\N	f	2026-05-25 00:27:02.188936	\N
291	1480402385821110292	1501015789656997909	301	\N	f	2026-05-25 00:27:07.439938	\N
292	1480402385821110292	1501015789656997909	292	\N	f	2026-05-25 00:32:07.708066	\N
293	1480402385821110292	1501015789656997909	284	\N	f	2026-05-25 00:32:13.061704	\N
294	1480402385821110292	1501015789656997909	307	\N	f	2026-05-25 00:32:18.327045	\N
295	1480402385821110292	1501015789656997909	284	\N	f	2026-05-25 00:37:18.636459	\N
296	1480402385821110292	1501015789656997909	298	\N	f	2026-05-25 00:37:23.916696	\N
297	1480402385821110292	1501015789656997909	301	\N	f	2026-05-25 00:37:29.808739	\N
298	1480402385821110292	1501015789656997909	289	\N	f	2026-05-25 00:42:30.138904	\N
299	1480402385821110292	1501015789656997909	270	\N	f	2026-05-25 00:42:35.471504	\N
300	1480402385821110292	1501015789656997909	290	\N	f	2026-05-25 00:42:40.797779	\N
301	1480402385821110292	1501015789656997909	288	\N	f	2026-05-25 00:54:32.352897	\N
302	1480402385821110292	1501015789656997909	270	\N	f	2026-05-25 00:54:37.665084	\N
303	1480402385821110292	1501015789656997909	269	\N	f	2026-05-25 00:54:42.909064	\N
304	1480402385821110292	1501015789656997909	290	\N	f	2026-05-25 01:02:25.704489	\N
305	1480402385821110292	1501015789656997909	289	\N	f	2026-05-25 01:02:31.016903	\N
306	1480402385821110292	1501015789656997909	276	\N	f	2026-05-25 01:02:36.400801	\N
307	1480402385821110292	1501015789656997909	287	1211353501909786749	f	2026-05-25 01:09:22.191452	2026-05-25 01:09:24.71
309	1480402385821110292	1501015789656997909	292	1211353501909786749	f	2026-05-25 01:09:32.702184	2026-05-25 01:09:42.768
308	1480402385821110292	1501015789656997909	267	1211353501909786749	f	2026-05-25 01:09:27.490718	2026-05-25 01:09:48.611
310	1480402385821110292	1501015789656997909	299	\N	f	2026-05-25 01:14:33.001793	\N
311	1480402385821110292	1501015789656997909	302	\N	f	2026-05-25 01:14:38.261533	\N
312	1480402385821110292	1501015789656997909	277	\N	f	2026-05-25 01:14:43.562234	\N
313	1480402385821110292	1501015789656997909	288	\N	f	2026-05-25 01:24:13.493423	\N
314	1480402385821110292	1501015789656997909	268	\N	f	2026-05-25 01:24:18.861854	\N
315	1480402385821110292	1501015789656997909	277	\N	f	2026-05-25 01:24:24.116082	\N
316	1480402385821110292	1501015789656997909	287	\N	f	2026-05-25 01:31:48.032423	\N
317	1480402385821110292	1501015789656997909	291	\N	f	2026-05-25 01:31:53.513639	\N
318	1480402385821110292	1501015789656997909	289	\N	f	2026-05-25 01:31:58.806788	\N
319	1480402385821110292	1501015789656997909	284	\N	f	2026-05-25 01:44:46.341328	\N
320	1480402385821110292	1501015789656997909	309	\N	f	2026-05-25 01:44:51.59042	\N
321	1480402385821110292	1501015789656997909	303	\N	f	2026-05-25 01:44:56.837172	\N
322	1480402385821110292	1501015789656997909	301	\N	f	2026-05-25 01:49:57.237461	\N
323	1480402385821110292	1501015789656997909	272	\N	f	2026-05-25 01:50:02.478839	\N
324	1480402385821110292	1501015789656997909	277	\N	f	2026-05-25 01:50:07.788695	\N
325	1480402385821110292	1501015789656997909	287	\N	f	2026-05-25 01:55:08.091982	\N
326	1480402385821110292	1501015789656997909	277	\N	f	2026-05-25 01:55:13.35228	\N
327	1480402385821110292	1501015789656997909	275	\N	f	2026-05-25 01:55:18.646641	\N
328	1480402385821110292	1501015789656997909	284	\N	f	2026-05-25 02:06:05.716084	\N
329	1480402385821110292	1501015789656997909	269	\N	f	2026-05-25 02:06:11.438764	\N
330	1480402385821110292	1501015789656997909	279	\N	f	2026-05-25 02:06:16.811719	\N
331	1480402385821110292	1501015789656997909	280	\N	f	2026-05-25 02:11:17.2242	\N
332	1480402385821110292	1501015789656997909	275	\N	f	2026-05-25 02:11:22.720702	\N
333	1480402385821110292	1501015789656997909	293	\N	f	2026-05-25 02:11:28.1828	\N
334	1480402385821110292	1501015789656997909	269	\N	f	2026-05-25 02:16:28.62604	\N
335	1480402385821110292	1501015789656997909	301	\N	f	2026-05-25 02:16:33.928148	\N
336	1480402385821110292	1501015789656997909	308	\N	f	2026-05-25 02:16:39.233901	\N
337	1480402385821110292	1501015789656997909	268	\N	f	2026-05-25 02:21:39.631017	\N
338	1480402385821110292	1501015789656997909	292	\N	f	2026-05-25 02:21:44.895721	\N
339	1480402385821110292	1501015789656997909	268	\N	f	2026-05-25 02:21:50.345294	\N
340	1480402385821110292	1501015789656997909	273	\N	f	2026-05-25 02:26:50.862812	\N
341	1480402385821110292	1501015789656997909	284	\N	f	2026-05-25 02:26:56.274781	\N
342	1480402385821110292	1501015789656997909	275	\N	f	2026-05-25 02:27:01.560656	\N
343	1480402385821110292	1501015789656997909	303	\N	f	2026-05-25 02:35:10.375203	\N
344	1480402385821110292	1501015789656997909	268	\N	f	2026-05-25 02:35:15.669602	\N
345	1480402385821110292	1501015789656997909	304	\N	f	2026-05-25 02:35:21.002131	\N
346	1480402385821110292	1501015789656997909	270	\N	f	2026-05-25 02:40:21.319098	\N
347	1480402385821110292	1501015789656997909	277	\N	f	2026-05-25 02:40:26.694106	\N
348	1480402385821110292	1501015789656997909	268	\N	f	2026-05-25 02:40:31.928069	\N
349	1480402385821110292	1501015789656997909	286	\N	f	2026-05-25 02:45:32.181208	\N
350	1480402385821110292	1501015789656997909	292	\N	f	2026-05-25 02:45:37.530117	\N
351	1480402385821110292	1501015789656997909	284	\N	f	2026-05-25 02:45:44.715154	\N
352	1480402385821110292	1501015789656997909	288	\N	f	2026-05-25 02:50:45.021799	\N
353	1480402385821110292	1501015789656997909	292	\N	f	2026-05-25 02:50:50.39336	\N
354	1480402385821110292	1501015789656997909	289	\N	f	2026-05-25 02:50:55.6706	\N
355	1480402385821110292	1501015789656997909	271	\N	f	2026-05-25 02:55:55.926646	\N
356	1480402385821110292	1501015789656997909	265	\N	f	2026-05-25 02:56:01.208666	\N
357	1480402385821110292	1501015789656997909	287	\N	f	2026-05-25 02:56:06.516572	\N
358	1480402385821110292	1501015789656997909	275	\N	f	2026-05-25 03:01:06.797741	\N
359	1480402385821110292	1501015789656997909	285	\N	f	2026-05-25 03:01:12.377502	\N
360	1480402385821110292	1501015789656997909	288	\N	f	2026-05-25 03:01:18.317058	\N
361	1480402385821110292	1501015789656997909	275	\N	f	2026-05-25 03:06:18.60014	\N
362	1480402385821110292	1501015789656997909	274	\N	f	2026-05-25 03:06:23.879418	\N
363	1480402385821110292	1501015789656997909	269	\N	f	2026-05-25 03:06:29.400244	\N
365	1480402385821110292	1501015789656997909	292	1211353501909786749	f	2026-05-25 03:11:35.101395	2026-05-25 03:11:36.244
366	1480402385821110292	1501015789656997909	292	\N	f	2026-05-25 03:11:40.365784	\N
364	1480402385821110292	1501015789656997909	297	1211353501909786749	f	2026-05-25 03:11:29.631757	2026-05-25 03:11:41.308
367	1480402385821110292	1501015789656997909	286	\N	f	2026-05-25 03:16:40.779799	\N
368	1480402385821110292	1501015789656997909	285	\N	f	2026-05-25 03:16:46.331036	\N
369	1480402385821110292	1501015789656997909	297	\N	f	2026-05-25 03:16:51.783464	\N
\.


--
-- Data for Name: trades; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.trades (id, guild_id, initiator_id, target_id, offered_card_id, requested_card_id, status, message_id, channel_id, created_at, resolved_at, offered_shards, requested_shards) FROM stdin;
1	1480402385821110292	1211353501909786749	1037737554641961030	\N	262	cancelled	1508029510879150150	1501015789656997909	2026-05-24 08:50:53.338755	2026-05-24 08:52:10.961	1	0
\.


--
-- Data for Name: user_currency; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_currency (id, guild_id, user_id, shards, total_earned, updated_at, packs_opened, cards_burned, packs_basic_week, packs_premium_week, packs_legendary_week, packs_week_reset_at, last_pack_opened_at) FROM stdin;
1	1480402385821110292	1211353501909786749	80	3330	2026-05-25 03:11:38.686	6	10	0	0	1	2026-06-01 00:00:00	2026-05-25 02:21:19.652
\.


--
-- Data for Name: user_timeouts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_timeouts (id, guild_id, user_id, expires_at, reason, issued_by, created_at) FROM stdin;
\.


--
-- Data for Name: wishlists; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wishlists (id, guild_id, user_id, card_id, created_at) FROM stdin;
1	1480402385821110292	1211353501909786749	314	2026-05-24 07:01:52.767913
\.


--
-- Name: achievements_unlocked_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.achievements_unlocked_id_seq', 2, true);


--
-- Name: admin_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.admin_users_id_seq', 1, false);


--
-- Name: card_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.card_events_id_seq', 1, false);


--
-- Name: cards_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.cards_id_seq', 314, true);


--
-- Name: collections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.collections_id_seq', 58, true);


--
-- Name: daily_claims_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.daily_claims_id_seq', 3, true);


--
-- Name: dashboard_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dashboard_users_id_seq', 4, true);


--
-- Name: embed_overrides_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.embed_overrides_id_seq', 1, true);


--
-- Name: guild_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.guild_settings_id_seq', 1, true);


--
-- Name: setup_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.setup_tokens_id_seq', 5, true);


--
-- Name: spawn_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.spawn_log_id_seq', 369, true);


--
-- Name: trades_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.trades_id_seq', 1, true);


--
-- Name: user_currency_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_currency_id_seq', 1, true);


--
-- Name: user_timeouts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_timeouts_id_seq', 1, false);


--
-- Name: wishlists_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.wishlists_id_seq', 1, true);


--
-- Name: achievements_unlocked achievements_unlocked_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements_unlocked
    ADD CONSTRAINT achievements_unlocked_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: card_events card_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_events
    ADD CONSTRAINT card_events_pkey PRIMARY KEY (id);


--
-- Name: cards cards_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_name_unique UNIQUE (name);


--
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);


--
-- Name: collections collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (id);


--
-- Name: daily_claims daily_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_claims
    ADD CONSTRAINT daily_claims_pkey PRIMARY KEY (id);


--
-- Name: dashboard_users dashboard_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_pkey PRIMARY KEY (id);


--
-- Name: dashboard_users dashboard_users_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_username_unique UNIQUE (username);


--
-- Name: embed_overrides embed_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embed_overrides
    ADD CONSTRAINT embed_overrides_pkey PRIMARY KEY (id);


--
-- Name: guild_settings guild_settings_guild_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guild_settings
    ADD CONSTRAINT guild_settings_guild_id_unique UNIQUE (guild_id);


--
-- Name: guild_settings guild_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guild_settings
    ADD CONSTRAINT guild_settings_pkey PRIMARY KEY (id);


--
-- Name: setup_tokens setup_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setup_tokens
    ADD CONSTRAINT setup_tokens_pkey PRIMARY KEY (id);


--
-- Name: setup_tokens setup_tokens_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setup_tokens
    ADD CONSTRAINT setup_tokens_token_unique UNIQUE (token);


--
-- Name: spawn_log spawn_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spawn_log
    ADD CONSTRAINT spawn_log_pkey PRIMARY KEY (id);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: user_currency user_currency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_currency
    ADD CONSTRAINT user_currency_pkey PRIMARY KEY (id);


--
-- Name: user_timeouts user_timeouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_timeouts
    ADD CONSTRAINT user_timeouts_pkey PRIMARY KEY (id);


--
-- Name: wishlists wishlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_pkey PRIMARY KEY (id);


--
-- Name: achievements_user_key_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX achievements_user_key_uniq ON public.achievements_unlocked USING btree (guild_id, user_id, achievement_key);


--
-- Name: collections_guild_user_card_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX collections_guild_user_card_uniq ON public.collections USING btree (guild_id, user_id, card_id);


--
-- Name: daily_claims_guild_user_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX daily_claims_guild_user_uniq ON public.daily_claims USING btree (guild_id, user_id);


--
-- Name: embed_overrides_guild_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX embed_overrides_guild_key_idx ON public.embed_overrides USING btree (guild_id, embed_key);


--
-- Name: wishlists_guild_card_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wishlists_guild_card_user_idx ON public.wishlists USING btree (guild_id, card_id, user_id);


--
-- Name: wishlists_guild_user_card_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wishlists_guild_user_card_uniq ON public.wishlists USING btree (guild_id, user_id, card_id);


--
-- Name: card_events card_events_card_id_cards_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_events
    ADD CONSTRAINT card_events_card_id_cards_id_fk FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;


--
-- Name: collections collections_card_id_cards_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_card_id_cards_id_fk FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: setup_tokens setup_tokens_reset_for_user_id_dashboard_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setup_tokens
    ADD CONSTRAINT setup_tokens_reset_for_user_id_dashboard_users_id_fk FOREIGN KEY (reset_for_user_id) REFERENCES public.dashboard_users(id) ON DELETE CASCADE;


--
-- Name: spawn_log spawn_log_card_id_cards_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spawn_log
    ADD CONSTRAINT spawn_log_card_id_cards_id_fk FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: trades trades_offered_card_id_cards_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_offered_card_id_cards_id_fk FOREIGN KEY (offered_card_id) REFERENCES public.cards(id);


--
-- Name: trades trades_requested_card_id_cards_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_requested_card_id_cards_id_fk FOREIGN KEY (requested_card_id) REFERENCES public.cards(id);


--
-- Name: wishlists wishlists_card_id_cards_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_card_id_cards_id_fk FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict jFbcF8LpTFXfceGg7cYXaXmUSnPejdq140Q5rQcWVOduh6QZonTYpPRNgMrdWyk

