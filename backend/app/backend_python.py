

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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"

GRAPH_CENTER = (16.42271, 120.59911)
GRAPH_RADIUS = 1100

ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

G = None
kmz_roads = None
penalty_lookup = {}

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

def get_memory_usage():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024

def parse_description(html):
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
    if pd.isna(width) or pd.isna(length):
        return 0
    elif width < 1.75:
        return length * 10
    elif width < 2.5:
        return length * 0.2
    else:
        return 0

def load_kmz_files():
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
        

        parsed = kmz_roads["description"].apply(parse_description)
        parsed_df = pd.DataFrame(parsed.tolist())
        kmz_roads = pd.concat([kmz_roads, parsed_df], axis=1)
        

        kmz_roads["RANGE_FROM"] = pd.to_numeric(kmz_roads["RANGE_FROM"], errors="coerce")
        kmz_roads["LENGTH_MAP"] = pd.to_numeric(kmz_roads["LENGTH_MAP"], errors="coerce")
        

        kmz_roads["width_penalty"] = kmz_roads.apply(
            lambda row: width_penalty(row["RANGE_FROM"], row["LENGTH_MAP"]), axis=1
        )
        
        logger.info(f"✅ Loaded {len(kmz_roads)} KMZ road segments")
    else:
        logger.warning("⚠️  No KMZ files loaded")

def build_graph():
    global G, penalty_lookup
    
    logger.info(f"Building OSM graph (center: {GRAPH_CENTER}, radius: {GRAPH_RADIUS}m)...")
    

    G = ox.graph_from_point(GRAPH_CENTER, dist=GRAPH_RADIUS, network_type="drive")
    
    logger.info(f"   Nodes: {G.number_of_nodes()}, Edges: {G.number_of_edges()}")
    

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
    

    logger.info("Applying cost models...")
    apply_cost_models()
    
    logger.info("✅ Graph ready")

def apply_cost_models():
    global G
    
    for u, v, k, data in G.edges(keys=True, data=True):
        base_length = data.get("length", 1)
        base_cost = penalty_lookup.get((u, v, k), base_length)
        
        highway_type = data.get('highway', 'residential')
        if isinstance(highway_type, list):
            highway_type = highway_type[0]
        

        lanes = 1
        if 'lanes' in data:
            try:
                lanes = int(data['lanes']) if not isinstance(data['lanes'], list) else int(data['lanes'][0])
            except:
                lanes = 1
        

        max_speed = 30
        if 'maxspeed' in data:
            try:
                speed = data['maxspeed']
                if isinstance(speed, list):
                    speed = speed[0]
                max_speed = int(str(speed).replace(' kph', '').replace(' mph', ''))
            except:
                max_speed = 30
        

        data["dijkstra_cost"] = base_length
        

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
        

        hybrid_cost = base_length
        

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
        

        width_penalty_amount = base_cost - base_length
        if width_penalty_amount > base_length * 3:
            hybrid_cost *= 1.10
        elif width_penalty_amount > base_length:
            hybrid_cost *= 1.03
        

        if base_length < 15:
            hybrid_cost *= 1.04
        elif base_length < 30:
            hybrid_cost *= 1.01
        
        data["hybrid_cost"] = hybrid_cost

def route_length(route, G):
    return sum(G[u][v][0].get("length", 0) for u, v in zip(route[:-1], route[1:]))

def route_cost(route, G, cost_attr):
    total = 0
    for u, v in zip(route[:-1], route[1:]):
        edge_data = G[u][v][0]
        total += edge_data.get(cost_attr, edge_data.get("length", 0))
    return total

def calculate_quality_score(route, G):
    score = 100.0
    total_length = 0
    
    for u, v in zip(route[:-1], route[1:]):
        edge = G[u][v][0]
        length = edge.get('length', 0)
        total_length += length
        
        highway = edge.get('highway', 'residential')
        if isinstance(highway, list):
            highway = highway[0]
        

        if highway in ['primary', 'primary_link', 'trunk', 'trunk_link']:
            score += (length / total_length if total_length > 0 else 0) * 10
        elif highway in ['service', 'unclassified']:
            score -= (length / total_length if total_length > 0 else 0) * 20
        elif highway in ['residential']:
            score -= (length / total_length if total_length > 0 else 0) * 8
        

        road_quality = edge.get('road_quality', 1.0)
        if road_quality > 1.05:
            score -= (length / total_length if total_length > 0 else 0) * 12
        

        if length < 20:
            score -= 0.5
    
    return max(0, min(100, score))

def euclidean_heuristic(u, v, G):
    x1, y1 = G.nodes[u]['x'], G.nodes[u]['y']
    x2, y2 = G.nodes[v]['x'], G.nodes[v]['y']
    return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5

def get_route_coordinates(route, G):
    coords = []
    for node in route:
        coords.append([G.nodes[node]['y'], G.nodes[node]['x']])
    return coords

def _reconstruct_path(prev, origin, destination):
    path, node = [], destination
    while node in prev:
        path.append(node)
        node = prev[node]
    path.append(origin)
    path.reverse()
    return path

def dijkstra_search(G, origin, destination, weight="dijkstra_cost"):
    dist = {node: float('inf') for node in G.nodes}
    dist[origin] = 0
    prev = {}
    visited = set()

    pq = [(0, origin)]

    while pq:
        d_u, u = heapq.heappop(pq)

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

            new_dist = dist[u] + w_uv
            if new_dist < dist[v]:
                dist[v] = new_dist
                prev[v] = u
                heapq.heappush(pq, (dist[v], v))

    return _reconstruct_path(prev, origin, destination)

def astar_search(G, origin, destination, weight="astar_cost", heuristic_scale=1.0):
    g = {node: float('inf') for node in G.nodes}
    g[origin] = 0

    prev = {}
    visited = set()

    def h(n):
        x1, y1 = G.nodes[n]['x'],           G.nodes[n]['y']
        x2, y2 = G.nodes[destination]['x'], G.nodes[destination]['y']
        return heuristic_scale * ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5

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

            g_new = g[u] + w_uv
            if g_new < g[v]:
                g[v]   = g_new
                f_v    = g_new + h(v)
                prev[v] = u
                heapq.heappush(pq, (f_v, v))

    return _reconstruct_path(prev, origin, destination)

def calculate_dijkstra(origin, destination):
    logger.info("Running Dijkstra (custom implementation)...")

    tracemalloc.start()
    start_time = time.time()

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
    logger.info("Running A* (custom implementation)...")

    tracemalloc.start()
    start_time = time.time()

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
    return lambda_map.get(highway_type, 0.4)

def hybrid_search(G, origin, destination):
    def h(n):
        x1, y1 = G.nodes[n]['x'],           G.nodes[n]['y']
        x2, y2 = G.nodes[destination]['x'], G.nodes[destination]['y']
        return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5

    g_d = {node: float('inf') for node in G.nodes}
    g_h = {node: float('inf') for node in G.nodes}
    g_d[origin] = 0.0
    g_h[origin] = 0.0

    prev    = {}
    visited = set()

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

            hw = edge.get("highway", "residential")
            if isinstance(hw, list):
                hw = hw[0]
            lam = get_lambda(hw)

            new_g_d = g_d[u] + base
            new_g_h = g_h[u] + hybrid_w
            H_v     = (1 - lam) * new_g_d + lam * (new_g_h + h(v))

            if new_g_d < g_d[v]:
                g_d[v]  = new_g_d
                g_h[v]  = new_g_h
                prev[v] = u
                heapq.heappush(pq, (H_v, v))

    return _reconstruct_path(prev, origin, destination)

def calculate_hybrid(origin, destination):
    logger.info("Running Hybrid (dynamic-λ formula)...")

    tracemalloc.start()
    start_time = time.time()

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 70)
    logger.info("🚀 STARTING ROUTING CALCULATOR BACKEND")
    logger.info("=" * 70)
    

    try:
        load_kmz_files()
    except Exception as e:
        logger.warning(f"Could not load KMZ files: {e}")
    

    build_graph()
    
    logger.info("✅ Backend ready!")
    
    yield
    
    logger.info("Shutting down...")

app = FastAPI(title="Routing Calculator API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {
        "status": "OK",
        "graph_nodes": G.number_of_nodes() if G else 0,
        "graph_edges": G.number_of_edges() if G else 0
    }

@app.post("/api/calculate-route")
async def calculate_route(request: RouteRequest):
    try:
        logger.info(f"📍 Route request: ({request.startLat}, {request.startLon}) → ({request.endLat}, {request.endLon})")
        

        origin = ox.nearest_nodes(G, request.startLon, request.startLat)
        destination = ox.nearest_nodes(G, request.endLon, request.endLat)
        

        dijkstra_result = calculate_dijkstra(origin, destination)
        astar_result = calculate_astar(origin, destination)
        hybrid_result = calculate_hybrid(origin, destination)

        d_km = float(dijkstra_result["distanceKm"])
        a_km = float(astar_result["distanceKm"])
        h_km = float(hybrid_result["distanceKm"])
        shortest = min(d_km, a_km, h_km)

        def optimality(dist):
            if shortest == 0:
                return 0.0
            return round((dist - shortest) / shortest * 100, 2)

        dijkstra_result["pathOptimality"] = optimality(d_km)
        astar_result["pathOptimality"]    = optimality(a_km)
        hybrid_result["pathOptimality"]   = optimality(h_km)

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

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "backend_python:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
