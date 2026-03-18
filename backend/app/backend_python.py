"""
Python FastAPI Backend for Routing Calculator
Implements Dijkstra, A*, and Hybrid algorithms using real OSM data
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
import geopandas as gpd
import pandas as pd
from bs4 import BeautifulSoup
import osmnx as ox
import networkx as nx
import time
import tracemalloc
import psutil
import os
import heapq
from pathlib import Path
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================
# CONFIGURATION
# ============================================

# Paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"

# Graph settings
GRAPH_CENTER = (16.42271, 120.59911)  # Baguio City
GRAPH_RADIUS = 1100  # meters

# CORS settings
ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

# ============================================
# GLOBAL VARIABLES
# ============================================

G = None  # OSM Graph
kmz_roads = None  # KMZ road data
penalty_lookup = {}  # Edge penalties


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class RouteRequest(BaseModel):
    startLat: float
    startLon: float
    endLat: float
    endLon: float


class AlgorithmResult(BaseModel):
    distanceKm: str
    timeMs: str
    nodes: int
    coordinates: list
    qualityScore: float
    peakMemoryMb: float


class RouteResponse(BaseModel):
    success: bool
    dijkstra: AlgorithmResult
    astar: AlgorithmResult
    hybrid: AlgorithmResult
    metadata: dict


# ============================================
# UTILITY FUNCTIONS
# ============================================

def get_memory_usage():
    """Get current memory usage in MB"""
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024


def parse_description(html):
    """Parse KMZ HTML description"""
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("tr")
    data = {}
    for row in rows:
        cells = row.find_all("td")
        if len(cells) == 2:
            key = cells[0].get_text(strip=True).upper()
            value = cells[1].get_text(strip=True)
            data[key] = value if value else None
    return data


def width_penalty(width, length):
    """Calculate penalty based on road width"""
    if pd.isna(width) or pd.isna(length):
        return 0
    elif width < 1.75:
        return length * 10
    elif width < 2.5:
        return length * 0.2
    else:
        return 0


# ============================================
# GRAPH INITIALIZATION
# ============================================

def load_kmz_files():
    """Load and parse KMZ files"""
    global kmz_roads
    
    logger.info("Loading KMZ files...")
    
    kmz_files = {
        "alley": DATA_DIR / "Alley.kmz",
        "barangay": DATA_DIR / "Barangay Road.kmz",
        "city": DATA_DIR / "City Road.kmz",
        "national": DATA_DIR / "National Road.kmz"
    }
    
    dataframes = []
    for name, filepath in kmz_files.items():
        if filepath.exists():
            logger.info(f"   Loading {filepath.name}...")
            try:
                gdf = gpd.read_file(filepath, driver="KML")
                dataframes.append(gdf)
            except Exception as e:
                logger.warning(f"   Failed to load {filepath.name}: {e}")
        else:
            logger.warning(f"   {filepath.name} not found")
    
    if dataframes:
        kmz_roads = gpd.GeoDataFrame(pd.concat(dataframes, ignore_index=True))
        
        # Parse descriptions
        parsed = kmz_roads["description"].apply(parse_description)
        parsed_df = pd.DataFrame(parsed.tolist())
        kmz_roads = pd.concat([kmz_roads, parsed_df], axis=1)
        
        # Convert columns
        kmz_roads["RANGE_FROM"] = pd.to_numeric(kmz_roads["RANGE_FROM"], errors="coerce")
        kmz_roads["LENGTH_MAP"] = pd.to_numeric(kmz_roads["LENGTH_MAP"], errors="coerce")
        
        # Calculate penalties
        kmz_roads["width_penalty"] = kmz_roads.apply(
            lambda row: width_penalty(row["RANGE_FROM"], row["LENGTH_MAP"]), axis=1
        )
        
        logger.info(f"✅ Loaded {len(kmz_roads)} KMZ road segments")
    else:
        logger.warning("⚠️  No KMZ files loaded")


def build_graph():
    """Build OSM graph and apply cost models"""
    global G, penalty_lookup
    
    logger.info(f"Building OSM graph (center: {GRAPH_CENTER}, radius: {GRAPH_RADIUS}m)...")
    
    # Download OSM data
    G = ox.graph_from_point(GRAPH_CENTER, dist=GRAPH_RADIUS, network_type="drive")
    
    logger.info(f"   Nodes: {G.number_of_nodes()}, Edges: {G.number_of_edges()}")
    
    # Apply KMZ penalties if available
    if kmz_roads is not None:
        logger.info("Applying KMZ penalties...")
        edges = ox.graph_to_gdfs(G, nodes=False, edges=True).reset_index()
        edges = edges.to_crs(kmz_roads.crs)
        
        edges_with_penalty = gpd.sjoin(
            edges, kmz_roads[["geometry", "width_penalty"]], 
            how="left", predicate="intersects"
        )
        edges_with_penalty["width_penalty"] = edges_with_penalty["width_penalty"].fillna(0)
        edges_with_penalty["cost"] = edges_with_penalty["length"] + edges_with_penalty["width_penalty"]
        
        penalty_lookup = edges_with_penalty.set_index(["u", "v", "key"])["cost"].to_dict()
    
    # Apply cost models to all edges
    logger.info("Applying cost models...")
    apply_cost_models()
    
    logger.info("✅ Graph ready")


def apply_cost_models():
    """Apply Dijkstra, A*, and Hybrid cost models to graph edges"""
    global G
    
    for u, v, k, data in G.edges(keys=True, data=True):
        base_length = data.get("length", 1)
        base_cost = penalty_lookup.get((u, v, k), base_length)
        
        highway_type = data.get('highway', 'residential')
        if isinstance(highway_type, list):
            highway_type = highway_type[0]
        
        # Get lanes
        lanes = 1
        if 'lanes' in data:
            try:
                lanes = int(data['lanes']) if not isinstance(data['lanes'], list) else int(data['lanes'][0])
            except:
                lanes = 1
        
        # Get max speed
        max_speed = 30
        if 'maxspeed' in data:
            try:
                speed = data['maxspeed']
                if isinstance(speed, list):
                    speed = speed[0]
                max_speed = int(str(speed).replace(' kph', '').replace(' mph', ''))
            except:
                max_speed = 30
        
        # === DIJKSTRA: Pure distance ===
        data["dijkstra_cost"] = base_length
        
        # === A*: Highway-biased ===
        astar_factor = 1.0
        if highway_type in ['primary', 'primary_link', 'trunk', 'trunk_link']:
            astar_factor = 0.3
        elif highway_type in ['secondary', 'secondary_link']:
            astar_factor = 0.6
        elif highway_type in ['tertiary', 'tertiary_link']:
            astar_factor = 1.0
        elif highway_type in ['residential']:
            astar_factor = 1.8
        elif highway_type in ['service', 'unclassified']:
            astar_factor = 2.5
        
        data["astar_cost"] = base_length * astar_factor
        
        # === HYBRID: Adaptive intelligent ===
        hybrid_cost = base_length
        
        # 1. Road type intelligence
        if highway_type in ['primary', 'primary_link', 'trunk', 'trunk_link']:
            if base_length > 100:
                hybrid_cost *= 0.95
            else:
                hybrid_cost *= 0.98
        elif highway_type in ['secondary', 'secondary_link']:
            if base_length > 100:
                hybrid_cost *= 0.98
            else:
                hybrid_cost *= 0.99
        elif highway_type in ['tertiary', 'tertiary_link']:
            hybrid_cost *= 1.0
        elif highway_type in ['residential']:
            if base_length > 100:
                hybrid_cost *= 1.08
            else:
                hybrid_cost *= 1.02
        elif highway_type in ['service', 'unclassified']:
            if base_length > 50:
                hybrid_cost *= 1.15
            else:
                hybrid_cost *= 1.05
        
        # 2. Lane width quality
        if lanes >= 4:
            hybrid_cost *= 0.94
        elif lanes == 3:
            hybrid_cost *= 0.97
        elif lanes == 2:
            hybrid_cost *= 1.0
        elif lanes == 1:
            if base_length > 50:
                hybrid_cost *= 1.06
            else:
                hybrid_cost *= 1.02
        
        # 3. Speed-based efficiency
        if max_speed >= 60:
            hybrid_cost *= 0.92
        elif max_speed >= 50:
            hybrid_cost *= 0.96
        elif max_speed >= 40:
            hybrid_cost *= 0.99
        elif max_speed >= 30:
            hybrid_cost *= 1.0
        else:
            hybrid_cost *= 1.08
        
        # 4. Width penalties
        width_penalty_amount = base_cost - base_length
        if width_penalty_amount > base_length * 3:
            hybrid_cost *= 1.10
        elif width_penalty_amount > base_length:
            hybrid_cost *= 1.03
        
        # 5. Turn complexity
        if base_length < 15:
            hybrid_cost *= 1.04
        elif base_length < 30:
            hybrid_cost *= 1.01
        
        data["hybrid_cost"] = hybrid_cost


# ============================================
# ALGORITHM FUNCTIONS
# ============================================

def route_length(route, G):
    """Calculate total route length"""
    return sum(G[u][v][0].get("length", 0) for u, v in zip(route[:-1], route[1:]))


def route_cost(route, G, cost_attr):
    """Calculate total route cost"""
    total = 0
    for u, v in zip(route[:-1], route[1:]):
        edge_data = G[u][v][0]
        total += edge_data.get(cost_attr, edge_data.get("length", 0))
    return total


def calculate_quality_score(route, G):
    """Calculate route quality score (0-100)"""
    score = 100.0
    total_length = 0
    
    for u, v in zip(route[:-1], route[1:]):
        edge = G[u][v][0]
        length = edge.get('length', 0)
        total_length += length
        
        highway = edge.get('highway', 'residential')
        if isinstance(highway, list):
            highway = highway[0]
        
        # Score adjustments
        if highway in ['primary', 'primary_link', 'trunk', 'trunk_link']:
            score += (length / total_length if total_length > 0 else 0) * 10
        elif highway in ['service', 'unclassified']:
            score -= (length / total_length if total_length > 0 else 0) * 20
        elif highway in ['residential']:
            score -= (length / total_length if total_length > 0 else 0) * 8
        
        # Width penalty
        road_quality = edge.get('road_quality', 1.0)
        if road_quality > 1.05:
            score -= (length / total_length if total_length > 0 else 0) * 12
        
        # Turn penalty
        if length < 20:
            score -= 0.5
    
    return max(0, min(100, score))


def euclidean_heuristic(u, v, G):
    """Euclidean distance heuristic for A*"""
    x1, y1 = G.nodes[u]['x'], G.nodes[u]['y']
    x2, y2 = G.nodes[v]['x'], G.nodes[v]['y']
    return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5


def get_route_coordinates(route, G):
    """Convert route to lat/lon coordinates"""
    coords = []
    for node in route:
        coords.append([G.nodes[node]['y'], G.nodes[node]['x']])
    return coords


# ============================================
# CUSTOM ALGORITHM IMPLEMENTATIONS
# Formulas implemented directly — no NetworkX
# path-finding calls used below.
# ============================================

def _reconstruct_path(prev, origin, destination):
    """
    Walk the 'prev' dictionary backwards from destination
    to origin to rebuild the ordered node list.
    """
    path, node = [], destination
    while node in prev:
        path.append(node)
        node = prev[node]
    path.append(origin)
    path.reverse()
    return path


def dijkstra_search(G, origin, destination, weight="dijkstra_cost"):
    """
    Custom Dijkstra implementation.

    Core relaxation formula (GeeksForGeeks / CLRS):
        dist[v] = min(dist[v],  dist[u] + w(u, v))

    Uses a min-heap (priority queue) to always expand the
    unvisited node with the lowest known distance first.

    Parameters
    ----------
    G          : NetworkX graph with edge attribute `weight`
    origin     : source node id
    destination: target node id
    weight     : edge attribute name to use as w(u,v)

    Returns
    -------
    list of node ids representing the shortest path
    """
    # Initialise every node's tentative distance to infinity
    dist = {node: float('inf') for node in G.nodes}
    dist[origin] = 0          # distance from source to itself is 0
    prev = {}                  # predecessor map for path reconstruction
    visited = set()

    # Priority queue entries: (dist[u], u)
    pq = [(0, origin)]

    while pq:
        d_u, u = heapq.heappop(pq)

        # Skip stale entries (already found a shorter path to u)
        if u in visited:
            continue
        visited.add(u)

        # Early exit — optimal path to destination found
        if u == destination:
            break

        # Relax all edges leaving u
        for v in G.neighbors(u):
            if v in visited:
                continue

            edge_data = G[u][v][0]
            w_uv = edge_data.get(weight, edge_data.get("length", 1))

            # ── DIJKSTRA FORMULA ──────────────────────────────────
            # dist[v] = min(dist[v],  dist[u] + w(u, v))
            new_dist = dist[u] + w_uv
            if new_dist < dist[v]:
                dist[v] = new_dist          # relaxation
                prev[v] = u
                heapq.heappush(pq, (dist[v], v))

    return _reconstruct_path(prev, origin, destination)


def astar_search(G, origin, destination, weight="astar_cost", heuristic_scale=1.0):
    """
    Custom A* implementation.

    Core formula (standard A* / ISPRS paper):
        f(n) = g(n) + h(n)

    where:
        g(n) = actual accumulated cost from origin to node n
        h(n) = Euclidean distance heuristic from n to destination
               (admissible — never overestimates true cost)
        f(n) = estimated total cost of path through n

    The node with the lowest f(n) is always expanded next.

    Parameters
    ----------
    G               : NetworkX graph
    origin          : source node id
    destination     : target node id
    weight          : edge attribute name to use as w(u,v)
    heuristic_scale : multiplier on h(n) (1.0 = standard A*)

    Returns
    -------
    list of node ids representing the optimal path
    """
    # g(n): actual cost from origin to each node
    g = {node: float('inf') for node in G.nodes}
    g[origin] = 0

    prev = {}
    visited = set()

    def h(n):
        """
        Euclidean heuristic  h(n) = sqrt((x1-x2)^2 + (y1-y2)^2)
        Uses lon/lat coordinates stored in OSM node attributes.
        """
        x1, y1 = G.nodes[n]['x'],           G.nodes[n]['y']
        x2, y2 = G.nodes[destination]['x'], G.nodes[destination]['y']
        return heuristic_scale * ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5

    # Priority queue entries: (f(n), n)
    # f(origin) = g(origin) + h(origin) = 0 + h(origin)
    pq = [(g[origin] + h(origin), origin)]

    while pq:
        f_u, u = heapq.heappop(pq)

        if u in visited:
            continue
        visited.add(u)

        if u == destination:
            break

        for v in G.neighbors(u):
            if v in visited:
                continue

            edge_data = G[u][v][0]
            w_uv = edge_data.get(weight, edge_data.get("length", 1))

            # ── A* FORMULA ────────────────────────────────────────
            # g(v)  = g(u) + w(u, v)          ← actual cost so far
            # h(v)  = euclidean distance to destination
            # f(v)  = g(v) + h(v)             ← estimated total cost
            g_new = g[u] + w_uv              # g(n)
            if g_new < g[v]:
                g[v]   = g_new
                f_v    = g_new + h(v)         # f(n) = g(n) + h(n)
                prev[v] = u
                heapq.heappush(pq, (f_v, v))

    return _reconstruct_path(prev, origin, destination)


# ============================================
# ALGORITHM ENTRY POINTS
# (wrap custom search with timing + memory)
# ============================================

def calculate_dijkstra(origin, destination):
    """
    Dijkstra — pure shortest path.
    Formula:  dist[v] = min(dist[v], dist[u] + w(u,v))
    Edge weight used: dijkstra_cost = base_length (OSM metres)
    """
    logger.info("Running Dijkstra (custom implementation)...")

    tracemalloc.start()
    start_time = time.time()

    # ── Custom Dijkstra — formula is inside dijkstra_search() ──
    route = dijkstra_search(G, origin, destination, weight="dijkstra_cost")

    end_time = time.time()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    length  = route_length(route, G)
    quality = calculate_quality_score(route, G)
    coords  = get_route_coordinates(route, G)

    return {
        "distanceKm"   : f"{length / 1000:.4f}",
        "timeMs"       : f"{(end_time - start_time) * 1000:.2f}",
        "nodes"        : len(route),
        "coordinates"  : coords,
        "qualityScore" : round(quality, 1),
        "peakMemoryMb" : round(peak / 1024 / 1024, 2)
    }


def calculate_astar(origin, destination):
    """
    A* — highway-biased routing.
    Formula:  f(n) = g(n) + h(n)
    Edge weight used: astar_cost = base_length × highway_factor
    Heuristic h(n): Euclidean distance to destination
    """
    logger.info("Running A* (custom implementation)...")

    tracemalloc.start()
    start_time = time.time()

    # ── Custom A* — formula is inside astar_search() ───────────
    route = astar_search(G, origin, destination,
                         weight="astar_cost",
                         heuristic_scale=1.0)

    end_time = time.time()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    length  = route_length(route, G)
    quality = calculate_quality_score(route, G)
    coords  = get_route_coordinates(route, G)

    return {
        "distanceKm"   : f"{length / 1000:.4f}",
        "timeMs"       : f"{(end_time - start_time) * 1000:.2f}",
        "nodes"        : len(route),
        "coordinates"  : coords,
        "qualityScore" : round(quality, 1),
        "peakMemoryMb" : round(peak / 1024 / 1024, 2)
    }


def get_lambda(highway_type):
    """
    Dynamic λ(road_type) — controls how much A*'s heuristic
    guidance influences the Hybrid cost relative to Dijkstra's
    shortest-path guarantee.

    Derivation logic:
      - Major roads (primary/trunk): λ is HIGH (→ 0.7)
        The heuristic is trusted more because these roads are
        efficient to follow; A* guidance helps us reach the
        destination quickly along known-good corridors.

      - Secondary roads: λ = 0.5 (balanced)
        Equal weight to distance and heuristic — road quality
        is acceptable but not dominant.

      - Tertiary roads: λ = 0.4
        Slightly more weight to Dijkstra's physical distance
        because tertiary roads vary more in quality.

      - Residential roads: λ is LOW (→ 0.3)
        Less trust in the heuristic; the algorithm should
        prefer staying short (Dijkstra) rather than being
        guided towards these roads.

      - Service / unclassified: λ is VERY LOW (→ 0.2)
        Maximum weight on Dijkstra's pure distance to avoid
        long detours on poor-quality roads.

    Range:  0.2 ≤ λ ≤ 0.7
    Constraint: (1 - λ) is the Dijkstra weight, always > 0
    """
    lambda_map = {
        'primary'       : 0.7,
        'primary_link'  : 0.7,
        'trunk'         : 0.7,
        'trunk_link'    : 0.7,
        'secondary'     : 0.5,
        'secondary_link': 0.5,
        'tertiary'      : 0.4,
        'tertiary_link' : 0.4,
        'residential'   : 0.3,
        'service'       : 0.2,
        'unclassified'  : 0.2,
    }
    return lambda_map.get(highway_type, 0.4)   # default: tertiary-like


def hybrid_search(G, origin, destination):
    """
    Adaptive Hybrid Algorithm.

    ═══════════════════════════════════════════════════════════
    FORMULA
    ═══════════════════════════════════════════════════════════

    H(n) = (1 - λ) · g_d(n)  +  λ · [g_h(n) + h(n)]

    where:
      g_d(n) = Σ base_length(u,v)          ← Dijkstra component
                 (u,v) ∈ path               pure physical distance

      g_h(n) = Σ hybrid_cost(u,v)          ← A* component (cost)
                 (u,v) ∈ path               = base_length × R×L×S×W×T

      h(n)   = √[(x_n - x_dest)²           ← A* component (heuristic)
                + (y_n - y_dest)²]          Euclidean distance to goal

      λ      = λ(road_type) ∈ [0.2, 0.7]  ← dynamic balance factor
               derived from the highway type of edge (u→v)

    ═══════════════════════════════════════════════════════════
    BEHAVIOUR BY λ VALUE
    ═══════════════════════════════════════════════════════════
      λ → 0.7  (primary/trunk):
          H(n) = 0.3·g_d + 0.7·[g_h + h]
          A* guidance dominates → fast, efficient major-road routing

      λ = 0.5  (secondary):
          H(n) = 0.5·g_d + 0.5·[g_h + h]
          Balanced → equal respect for distance and quality

      λ → 0.2  (service/unclassified):
          H(n) = 0.8·g_d + 0.2·[g_h + h]
          Dijkstra dominates → stay short, avoid poor-road detours
    ═══════════════════════════════════════════════════════════

    Parameters
    ----------
    G           : NetworkX MultiDiGraph (OSM road network)
    origin      : source node id
    destination : target node id

    Returns
    -------
    list of node ids — the optimal hybrid path
    """

    def h(n):
        """
        Euclidean heuristic  h(n) = √[(x₁−x₂)² + (y₁−y₂)²]
        Admissible: never overestimates true geographic distance.
        """
        x1, y1 = G.nodes[n]['x'],           G.nodes[n]['y']
        x2, y2 = G.nodes[destination]['x'], G.nodes[destination]['y']
        return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5

    # Accumulated costs from origin to each node
    g_d = {node: float('inf') for node in G.nodes}   # Dijkstra distance
    g_h = {node: float('inf') for node in G.nodes}   # Hybrid weighted cost
    g_d[origin] = 0.0
    g_h[origin] = 0.0

    prev    = {}
    visited = set()

    # Initial priority: H(origin) = (1-λ)·0 + λ·h(origin)
    # λ at origin uses default (0.4) since no edge yet
    lam0 = 0.4
    pq   = [((1 - lam0) * 0.0 + lam0 * h(origin), origin)]

    while pq:
        H_u, u = heapq.heappop(pq)

        if u in visited:
            continue
        visited.add(u)

        if u == destination:
            break

        for v in G.neighbors(u):
            if v in visited:
                continue

            edge      = G[u][v][0]
            base      = edge.get("length",      1.0)
            hybrid_w  = edge.get("hybrid_cost", base)

            # Determine dynamic λ from this edge's road type
            hw = edge.get("highway", "residential")
            if isinstance(hw, list):
                hw = hw[0]
            lam = get_lambda(hw)

            # ── HYBRID FORMULA ──────────────────────────────────
            # g_d(v) = g_d(u) + base_length(u,v)     [Dijkstra]
            # g_h(v) = g_h(u) + hybrid_cost(u,v)     [A* cost]
            # H(v)   = (1-λ)·g_d(v) + λ·[g_h(v) + h(v)]
            new_g_d = g_d[u] + base
            new_g_h = g_h[u] + hybrid_w
            H_v     = (1 - lam) * new_g_d + lam * (new_g_h + h(v))

            if new_g_d < g_d[v]:       # improvement found
                g_d[v]  = new_g_d
                g_h[v]  = new_g_h
                prev[v] = u
                heapq.heappush(pq, (H_v, v))

    return _reconstruct_path(prev, origin, destination)


def calculate_hybrid(origin, destination):
    """
    Entry point for the Hybrid algorithm.

    Formula:  H(n) = (1 - λ) · g_d(n)  +  λ · [g_h(n) + h(n)]

    λ = λ(road_type) — dynamic balance factor per edge:
        primary/trunk   → λ = 0.7   (A* guidance dominates)
        secondary       → λ = 0.5   (balanced)
        tertiary        → λ = 0.4   (slight Dijkstra preference)
        residential     → λ = 0.3   (Dijkstra preferred)
        service/unclas. → λ = 0.2   (Dijkstra strongly preferred)
    """
    logger.info("Running Hybrid (dynamic-λ formula)...")

    tracemalloc.start()
    start_time = time.time()

    # ── Hybrid search using H(n) = (1-λ)·g_d(n) + λ·[g_h(n)+h(n)] ──
    route = hybrid_search(G, origin, destination)

    end_time = time.time()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    length  = route_length(route, G)
    quality = calculate_quality_score(route, G)
    coords  = get_route_coordinates(route, G)

    return {
        "distanceKm"   : f"{length / 1000:.4f}",
        "timeMs"       : f"{(end_time - start_time) * 1000:.2f}",
        "nodes"        : len(route),
        "coordinates"  : coords,
        "qualityScore" : round(quality, 1),
        "peakMemoryMb" : round(peak / 1024 / 1024, 2)
    }


# ============================================
# FASTAPI APP
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    logger.info("=" * 70)
    logger.info("🚀 STARTING ROUTING CALCULATOR BACKEND")
    logger.info("=" * 70)
    
    # Load KMZ files
    try:
        load_kmz_files()
    except Exception as e:
        logger.warning(f"Could not load KMZ files: {e}")
    
    # Build graph
    build_graph()
    
    logger.info("✅ Backend ready!")
    
    yield
    
    logger.info("Shutting down...")


app = FastAPI(title="Routing Calculator API", lifespan=lifespan)

# Add CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# API ENDPOINTS
# ============================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "OK",
        "graph_nodes": G.number_of_nodes() if G else 0,
        "graph_edges": G.number_of_edges() if G else 0
    }


@app.post("/api/calculate-route")
async def calculate_route(request: RouteRequest):
    """Calculate routes using all three algorithms"""
    try:
        logger.info(f"📍 Route request: ({request.startLat}, {request.startLon}) → ({request.endLat}, {request.endLon})")
        
        # Find nearest nodes
        origin = ox.nearest_nodes(G, request.startLon, request.startLat)
        destination = ox.nearest_nodes(G, request.endLon, request.endLat)
        
        # Calculate all routes
        dijkstra_result = calculate_dijkstra(origin, destination)
        astar_result = calculate_astar(origin, destination)
        hybrid_result = calculate_hybrid(origin, destination)
        
        logger.info("✅ Routes calculated successfully")
        
        return {
            "success": True,
            "dijkstra": dijkstra_result,
            "astar": astar_result,
            "hybrid": hybrid_result,
            "metadata": {
                "graph_nodes": G.number_of_nodes(),
                "graph_edges": G.number_of_edges()
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# RUN SERVER
# ============================================

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "backend_python:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
