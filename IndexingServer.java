import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.OutputStream;
import java.io.Serializable;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentSkipListSet;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class IndexingServer {
    private static final ConcurrentHashMap<String, Set<String>> fileIndex = new ConcurrentHashMap();
    private static final ConcurrentHashMap<String, Long> activePeers = new ConcurrentHashMap();
    private static final ConcurrentHashMap<String, Long> peerLatency = new ConcurrentHashMap();
    private static ConcurrentHashMap<String, Playlist> playlists = new ConcurrentHashMap();
    private static AtomicInteger playlistIdCounter = new AtomicInteger(1);
    private static final String PLAYLIST_FILE = "playlists.dat";
    private static final String UPLOAD_DIR = "uploads";
    private static final int PORT = 8081;
    private static final long PEER_TIMEOUT_MS = 30000L;

    public static void main(String[] stringArray) throws IOException {
        File file = new File(UPLOAD_DIR);
        if (!file.exists()) {
            file.mkdirs();
            IndexingServer.log("INFO", "Folder upload 'uploads' berhasil dibuat.");
        }
        IndexingServer.startPeerTimeoutTask();
        IndexingServer.loadPlaylists();
        HttpServer httpServer = HttpServer.create(new InetSocketAddress(8081), 0);
        httpServer.createContext("/search", new SearchHandler());
        httpServer.createContext("/register_file", new RegisterHandler());
        httpServer.createContext("/stats", new StatsHandler());
        httpServer.createContext("/heartbeat", new HeartbeatHandler());
        httpServer.createContext("/upload", new UploadHandler());
        httpServer.createContext("/list_files", new ListFilesHandler());
        httpServer.createContext("/delete_file", new DeleteFileHandler());
        httpServer.createContext("/music/", new MusicServeHandler());
        httpServer.createContext("/playlists", new PlaylistsListHandler());
        httpServer.createContext("/playlist/create", new PlaylistCreateHandler());
        httpServer.createContext("/playlist/add_song", new PlaylistAddSongHandler());
        httpServer.createContext("/playlist/remove_song", new PlaylistRemoveSongHandler());
        httpServer.createContext("/playlist/songs", new PlaylistSongsHandler());
        httpServer.setExecutor(Executors.newCachedThreadPool());
        IndexingServer.log("INFO", "Indexing Server berhasil dijalankan pada port 8081");
        IndexingServer.log("INFO", "Upload directory: " + file.getAbsolutePath());
        IndexingServer.log("INFO", "Menunggu request dari Peer Node...");
        httpServer.start();
    }

    private static void startPeerTimeoutTask() {
        Thread thread = new Thread(() -> {
            try {
                while (true) {
                    Thread.sleep(10000L);
                    long l = System.currentTimeMillis();
                    activePeers.entrySet().removeIf(entry -> l - (Long)entry.getValue() > 30000L);
                }
            }
            catch (InterruptedException interruptedException) {
                return;
            }
        });
        thread.setDaemon(true);
        thread.start();
    }

    private static void loadPlaylists() {
        File file = new File(PLAYLIST_FILE);
        if (file.exists()) {
            try (ObjectInputStream objectInputStream = new ObjectInputStream(new FileInputStream(file));){
                playlists = (ConcurrentHashMap)objectInputStream.readObject();
                int n = 0;
                for (String string : playlists.keySet()) {
                    if (!string.startsWith("PL-")) continue;
                    try {
                        int n2 = Integer.parseInt(string.substring(3));
                        if (n2 <= n) continue;
                        n = n2;
                    }
                    catch (Exception exception) {}
                }
                playlistIdCounter.set(n + 1);
                IndexingServer.log("INFO", "Loaded " + playlists.size() + " playlists dari disk.");
            }
            catch (Exception exception) {
                IndexingServer.log("ERROR", "Gagal me-load playlists: " + exception.getMessage());
            }
        }
    }

    private static synchronized void savePlaylists() {
        try (ObjectOutputStream objectOutputStream = new ObjectOutputStream(new FileOutputStream(PLAYLIST_FILE));){
            objectOutputStream.writeObject(playlists);
        }
        catch (Exception exception) {
            IndexingServer.log("ERROR", "Gagal menyimpan playlists: " + exception.getMessage());
        }
    }

    private static boolean handleCORS(HttpExchange httpExchange) throws IOException {
        httpExchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        httpExchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
        httpExchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type, X-Node-Id");
        if ("OPTIONS".equalsIgnoreCase(httpExchange.getRequestMethod())) {
            httpExchange.sendResponseHeaders(204, -1L);
            return true;
        }
        return false;
    }

    private static void sendResponse(HttpExchange httpExchange, int n, String string) throws IOException {
        byte[] byArray = string.getBytes(StandardCharsets.UTF_8);
        httpExchange.getResponseHeaders().add("Content-Type", "application/json; charset=UTF-8");
        httpExchange.sendResponseHeaders(n, byArray.length);
        try (OutputStream outputStream = httpExchange.getResponseBody();){
            outputStream.write(byArray);
        }
    }

    private static String extractQueryParam(String string, String string2) {
        if (string == null) {
            return null;
        }
        for (String string3 : string.split("&")) {
            String[] stringArray = string3.split("=", 2);
            if (stringArray.length <= 1 || !stringArray[0].equals(string2)) continue;
            return stringArray[1];
        }
        return null;
    }

    private static String extractJsonValue(String string, String string2) {
        String string3 = "\"" + string2 + "\"";
        int n = string.indexOf(string3);
        if (n == -1) {
            return null;
        }
        int n2 = string.indexOf(":", n);
        if (n2 == -1) {
            return null;
        }
        int n3 = string.indexOf("\"", n2);
        if (n3 == -1) {
            return null;
        }
        int n4 = string.indexOf("\"", n3 + 1);
        if (n4 == -1) {
            return null;
        }
        return string.substring(n3 + 1, n4);
    }

    private static String escapeJson(String string) {
        if (string == null) {
            return "";
        }
        return string.replace("\\", "\\\\").replace("\"", "\\\"").replace("\b", "\\b").replace("\f", "\\f").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }

    private static String getMimeType(String string) {
        String string2 = string.toLowerCase();
        if (string2.endsWith(".mp3")) {
            return "audio/mpeg";
        }
        if (string2.endsWith(".wav")) {
            return "audio/wav";
        }
        if (string2.endsWith(".ogg")) {
            return "audio/ogg";
        }
        if (string2.endsWith(".flac")) {
            return "audio/flac";
        }
        if (string2.endsWith(".aac")) {
            return "audio/aac";
        }
        if (string2.endsWith(".m4a")) {
            return "audio/mp4";
        }
        if (string2.endsWith(".weba")) {
            return "audio/webm";
        }
        return "application/octet-stream";
    }

    private static String extractBoundary(String string) {
        for (String string2 : string.split(";")) {
            if (!(string2 = string2.trim()).startsWith("boundary=")) continue;
            String string3 = string2.substring("boundary=".length()).trim();
            if (string3.startsWith("\"") && string3.endsWith("\"")) {
                string3 = string3.substring(1, string3.length() - 1);
            }
            return string3;
        }
        return null;
    }

    private static String parseMultipartFilename(byte[] byArray, String string) {
        String string2 = new String(byArray, StandardCharsets.UTF_8);
        String string3 = "filename=\"";
        int n = string2.indexOf(string3);
        if (n == -1) {
            return null;
        }
        int n2 = string2.indexOf("\"", n += string3.length());
        if (n2 == -1) {
            return null;
        }
        return string2.substring(n, n2);
    }

    private static byte[] parseMultipartFileData(byte[] byArray, String string) {
        byte[] byArray2 = "\r\n\r\n".getBytes(StandardCharsets.UTF_8);
        int n = IndexingServer.indexOf(byArray, byArray2, 0);
        if (n == -1 && (n = IndexingServer.indexOf(byArray, byArray2 = "\n\n".getBytes(StandardCharsets.UTF_8), 0)) == -1) {
            return null;
        }
        int n2 = n + byArray2.length;
        byte[] byArray3 = ("\r\n--" + string).getBytes(StandardCharsets.UTF_8);
        int n3 = IndexingServer.indexOf(byArray, byArray3, n2);
        if (n3 == -1 && (n3 = IndexingServer.indexOf(byArray, byArray3 = ("\n--" + string).getBytes(StandardCharsets.UTF_8), n2)) == -1) {
            return null;
        }
        byte[] byArray4 = new byte[n3 - n2];
        System.arraycopy(byArray, n2, byArray4, 0, byArray4.length);
        return byArray4;
    }

    private static int indexOf(byte[] byArray, byte[] byArray2, int n) {
        for (int i = n; i <= byArray.length - byArray2.length; ++i) {
            boolean bl = true;
            for (int j = 0; j < byArray2.length; ++j) {
                if (byArray[i + j] == byArray2[j]) continue;
                bl = false;
                break;
            }
            if (!bl) continue;
            return i;
        }
        return -1;
    }

    private static void log(String string, String string2) {
        String string3 = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());
        System.out.printf("[%s] [%-6s] %s%n", string3, string, string2);
    }
    /**
     * Handler ini bertugas untuk mencari lagu (Search). 
     * Melakukan iterasi pada struktur data Map untuk mencari file yang cocok
     * secara parsial (fuzzy match) dan mengembalikan daftar nama file beserta Node pemiliknya.
     */

    static class SearchHandler
    implements HttpHandler {
        SearchHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("GET".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                String string = httpExchange.getRequestURI().getQuery();
                String string2 = IndexingServer.extractQueryParam(string, "filename");
                if (string2 != null && !string2.trim().isEmpty()) {
                    Object object;
                    string2 = URLDecoder.decode(string2, StandardCharsets.UTF_8.name());
                    String string3 = string2.trim().toLowerCase();
                    StringBuilder stringBuilder = new StringBuilder();
                    stringBuilder.append("{\n");
                    stringBuilder.append("  \"query\": \"").append(IndexingServer.escapeJson(string2)).append("\",\n");
                    stringBuilder.append("  \"results\": [");
                    int n = 0;
                    for (Map.Entry<String, Set<String>> fileArray2 : fileIndex.entrySet()) {
                        Set<String> set;
                        String fileArray = fileArray2.getKey();
                        if (!fileArray.contains(string3) || (set = fileArray2.getValue()) == null || set.isEmpty()) continue;
                        if (n > 0) {
                            stringBuilder.append(", ");
                        }
                        String string4 = this.findOriginalFilename((String)fileArray);
                        boolean bl = false;
                        object = new File(IndexingServer.UPLOAD_DIR);
                        File[] fileArray3 = ((File)object).listFiles();
                        if (fileArray3 != null) {
                            for (File file : fileArray3) {
                                if (!file.getName().toLowerCase().contains(string3)) continue;
                                bl = true;
                                string4 = file.getName();
                                break;
                            }
                        }
                        stringBuilder.append("\n    {");
                        stringBuilder.append("\"filename\": \"").append(IndexingServer.escapeJson(string4)).append("\", ");
                        stringBuilder.append("\"existsOnServer\": ").append(bl).append(", ");
                        stringBuilder.append("\"nodes\": [");
                        int n2 = 0;
                        for (String string5 : set) {
                            if (n2 > 0) {
                                stringBuilder.append(", ");
                            }
                            stringBuilder.append("\"").append(IndexingServer.escapeJson(string5)).append("\"");
                            ++n2;
                        }
                        stringBuilder.append("]}");
                        ++n;
                    }
                    File file = new File(IndexingServer.UPLOAD_DIR);
                    File[] fileArray = file.listFiles();
                    if (fileArray != null) {
                        for (File file2 : fileArray) {
                            if (!file2.isFile() || !((String)(object = file2.getName().toLowerCase())).contains(string3) || fileIndex.containsKey(object)) continue;
                            if (n > 0) {
                                stringBuilder.append(", ");
                            }
                            stringBuilder.append("\n    {");
                            stringBuilder.append("\"filename\": \"").append(IndexingServer.escapeJson(file2.getName())).append("\", ");
                            stringBuilder.append("\"existsOnServer\": true, ");
                            stringBuilder.append("\"nodes\": [\"Server\"]}");
                            ++n;
                        }
                    }
                    stringBuilder.append("\n  ]\n}");
                    if (n > 0) {
                        IndexingServer.log("SEARCH", "Fuzzy query '" + string2 + "' \u2192 " + n + " hasil ditemukan.");
                    } else {
                        IndexingServer.log("SEARCH", "Fuzzy query '" + string2 + "' \u2192 Tidak ditemukan.");
                    }
                    IndexingServer.sendResponse(httpExchange, 200, stringBuilder.toString());
                } else {
                    IndexingServer.log("ERROR", "/search dipanggil tanpa parameter filename.");
                    IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Missing filename parameter\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }

        private String findOriginalFilename(String string) {
            File file = new File(IndexingServer.UPLOAD_DIR);
            File[] fileArray = file.listFiles();
            if (fileArray != null) {
                for (File file2 : fileArray) {
                    if (!file2.getName().toLowerCase().equals(string)) continue;
                    return file2.getName();
                }
            }
            return string;
        }
    }
    /**
     * Handler ini digunakan untuk mendaftarkan/mencatat file milik node lain 
     * ke dalam memori server tanpa mengupload file fisiknya.
     * Berguna untuk simulasi index P2P dari node eksternal.
     */

    static class RegisterHandler
    implements HttpHandler {
        RegisterHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("POST".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                InputStream inputStream = httpExchange.getRequestBody();
                String string2 = new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
                String string3 = IndexingServer.extractJsonValue(string2, "filename");
                String string4 = IndexingServer.extractJsonValue(string2, "nodeId");
                if (string3 != null && string4 != null) {
                    String string5 = string3.trim().toLowerCase();
                    fileIndex.computeIfAbsent(string5, string -> new ConcurrentSkipListSet()).add(string4);
                    activePeers.put(string4, System.currentTimeMillis());
                    IndexingServer.log("INDEX", string4 + " mendaftarkan file '" + string3 + "'");
                    IndexingServer.sendResponse(httpExchange, 200, "{\"status\": \"success\", \"message\": \"File registered successfully\"}");
                } else {
                    IndexingServer.log("ERROR", "Format JSON /register_file tidak valid. Payload: " + string2);
                    IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Invalid JSON payload\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler ini mengembalikan data statistik jaringan secara real-time,
     * seperti jumlah peer aktif, jumlah file yang dibagikan, 
     * dan latensi rata-rata dari seluruh Node yang terhubung.
     */

    static class StatsHandler
    implements HttpHandler {
        StatsHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("GET".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                long l = System.currentTimeMillis();
                activePeers.entrySet().removeIf(entry -> l - (Long)entry.getValue() > 30000L);
                int n = fileIndex.size();
                int n2 = activePeers.size();
                long l2 = 0L;
                if (!peerLatency.isEmpty()) {
                    long l3 = 0L;
                    for (long l4 : peerLatency.values()) {
                        l3 += l4;
                    }
                    l2 = l3 / (long)peerLatency.size();
                }
                java.util.Set<String> allFiles = new java.util.HashSet<>(fileIndex.keySet());
                File file = new File(IndexingServer.UPLOAD_DIR);
                int n3 = 0;
                long l5 = 0L;
                File[] fileArray = file.listFiles();
                if (fileArray != null) {
                    for (File object : fileArray) {
                        if (!object.isFile() || object.getName().endsWith(".owner")) continue;
                        allFiles.add(object.getName().trim().toLowerCase());
                        ++n3;
                        l5 += object.length();
                    }
                }
                n = allFiles.size();
                StringBuilder stringBuilder = new StringBuilder("[");
                int n4 = 0;
                for (Map.Entry<String, Long> entry2 : activePeers.entrySet()) {
                    if (n4 > 0) {
                        stringBuilder.append(", ");
                    }
                    long l3 = (l - entry2.getValue()) / 1000L;
                    Long l4 = peerLatency.get(entry2.getKey());
                    stringBuilder.append("{\"nodeId\": \"").append(IndexingServer.escapeJson(entry2.getKey())).append("\", \"lastSeen\": ").append(l3).append(", \"latency\": ").append(l4 != null ? l4 : 0L).append("}");
                    ++n4;
                }
                stringBuilder.append("]");
                String string = "{\n  \"activePeers\": " + n2 + ",\n  \"totalFiles\": " + n + ",\n  \"uploadedFiles\": " + n3 + ",\n  \"totalSizeBytes\": " + l5 + ",\n  \"avgLatencyMs\": " + l2 + ",\n  \"peers\": " + stringBuilder.toString() + "\n}";
                IndexingServer.sendResponse(httpExchange, 200, string);
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler ini bertugas sebagai sinyal detak jantung (ping). 
     * Dipanggil berkala oleh browser pengguna untuk memberitahu server 
     * bahwa Node pengguna masih aktif dan online.
     */

    static class HeartbeatHandler
    implements HttpHandler {
        HeartbeatHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("POST".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                long l = System.currentTimeMillis();
                InputStream inputStream = httpExchange.getRequestBody();
                String string = new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
                String string2 = IndexingServer.extractJsonValue(string, "nodeId");
                if (string2 != null) {
                    activePeers.put(string2, System.currentTimeMillis());
                    long l2 = System.currentTimeMillis() - l;
                    peerLatency.put(string2, l2);
                    IndexingServer.sendResponse(httpExchange, 200, "{\"status\": \"alive\", \"serverTime\": " + System.currentTimeMillis() + "}");
                } else {
                    IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Missing nodeId\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler ini menangani proses unggah (Upload) file multipart dari browser.
     * Selain menyimpan file .mp3, handler ini juga membuat file metadata kepemilikan
     * berakhiran .owner yang menyimpan Node-ID si pengupload.
     */

    static class UploadHandler
    implements HttpHandler {
        UploadHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("POST".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                String string2 = httpExchange.getRequestHeaders().getFirst("Content-Type");
                if (string2 != null && string2.startsWith("multipart/form-data")) {
                    String string3 = IndexingServer.extractBoundary(string2);
                    if (string3 == null) {
                        IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Invalid multipart boundary\"}");
                        return;
                    }
                    byte[] byArray = httpExchange.getRequestBody().readAllBytes();
                    String string4 = IndexingServer.parseMultipartFilename(byArray, string3);
                    byte[] byArray2 = IndexingServer.parseMultipartFileData(byArray, string3);
                    if (string4 != null && byArray2 != null && byArray2.length > 0) {
                        string4 = Paths.get(string4, new String[0]).getFileName().toString();
                        Path path = Paths.get(IndexingServer.UPLOAD_DIR, string4);
                        Files.write(path, byArray2, new OpenOption[0]);
                        long l = byArray2.length / 1024;
                        IndexingServer.log("UPLOAD", "File '" + string4 + "' berhasil disimpan (" + l + " KB)");
                        String string5 = httpExchange.getRequestHeaders().getFirst("X-Node-Id");
                        if (string5 == null || string5.trim().isEmpty()) {
                            string5 = "Server";
                        }
                        try {
                            Path ownerPath = Paths.get(IndexingServer.UPLOAD_DIR, string4 + ".owner");
                            Files.writeString(ownerPath, string5, java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.TRUNCATE_EXISTING);
                        } catch(Exception e) {
                            IndexingServer.log("ERROR", "Failed to write owner file for: " + string4);
                        }
                        String string6 = string4.trim().toLowerCase();
                        fileIndex.computeIfAbsent(string6, string -> new ConcurrentSkipListSet()).add(string5);
                        activePeers.put(string5, System.currentTimeMillis());
                        IndexingServer.sendResponse(httpExchange, 200, "{\"status\": \"success\", \"filename\": \"" + IndexingServer.escapeJson(string4) + "\", \"size\": " + byArray2.length + "}");
                    } else {
                        IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"No file data found in upload\"}");
                    }
                } else {
                    IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Content-Type must be multipart/form-data\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler ini bertugas untuk menampilkan seluruh daftar lagu 
     * yang benar-benar tersimpan secara fisik di folder server (uploads/).
     * Menambahkan informasi Node-ID pemilik pada hasil JSON.
     */

    static class ListFilesHandler
    implements HttpHandler {
        ListFilesHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("GET".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                File file3 = new File(IndexingServer.UPLOAD_DIR);
                File[] fileArray = file3.listFiles();
                StringBuilder stringBuilder = new StringBuilder("{\n  \"files\": [");
                if (fileArray != null && fileArray.length > 0) {
                    int n = 0;
                    Arrays.sort(fileArray, (file, file2) -> Long.compare(file2.lastModified(), file.lastModified()));
                    for (File file4 : fileArray) {
                        if (!file4.isFile() || file4.getName().endsWith(".owner")) continue;
                        if (n > 0) {
                            stringBuilder.append(", ");
                        }
                        String string = file4.getName();
                        long l = file4.length();
                        long l2 = file4.lastModified();
                        String string2 = string.trim().toLowerCase();
                        Set<String> set = fileIndex.get(string2);
                        StringBuilder stringBuilder2 = new StringBuilder("[");
                        if (set != null) {
                            int n2 = 0;
                            for (String string3 : set) {
                                if (n2 > 0) {
                                    stringBuilder2.append(", ");
                                }
                                stringBuilder2.append("\"").append(IndexingServer.escapeJson(string3)).append("\"");
                                ++n2;
                            }
                        }
                        stringBuilder2.append("]");
                        String uploadedBy = "Server";
                        try {
                            Path ownerPath = Paths.get(IndexingServer.UPLOAD_DIR, string + ".owner");
                            if (Files.exists(ownerPath)) {
                                uploadedBy = Files.readString(ownerPath).trim();
                            }
                        } catch (Exception e) {}
                        stringBuilder.append("\n    {").append("\"name\": \"").append(IndexingServer.escapeJson(string)).append("\", ").append("\"size\": ").append(l).append(", ").append("\"modified\": ").append(l2).append(", ").append("\"owners\": ").append(stringBuilder2.toString()).append(", \"uploadedBy\": \"").append(IndexingServer.escapeJson(uploadedBy)).append("\"}");
                        ++n;
                    }
                }
                stringBuilder.append("\n  ]\n}");
                IndexingServer.sendResponse(httpExchange, 200, stringBuilder.toString());
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler ini bertugas untuk menghapus file dari server.
     * Dilengkapi verifikasi keamanan: File hanya bisa dihapus jika HTTP Header X-Node-Id 
     * milik pengguna cocok dengan Node-ID di dalam file .owner file tersebut.
     */

    static class DeleteFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) return;
            if ("DELETE".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                String query = httpExchange.getRequestURI().getQuery();
                if (query == null || !query.startsWith("filename=")) {
                    IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Missing filename parameter\"}");
                    return;
                }
                String filename = URLDecoder.decode(query.substring(9), StandardCharsets.UTF_8.name());

                String reqNodeId = httpExchange.getRequestHeaders().getFirst("X-Node-Id");
                if (reqNodeId == null) reqNodeId = "Server";

                String uploadedBy = "Server";
                Path ownerPath = Paths.get(IndexingServer.UPLOAD_DIR, filename + ".owner");
                if (Files.exists(ownerPath)) {
                    uploadedBy = Files.readString(ownerPath).trim();
                }

                if (!reqNodeId.equals(uploadedBy)) {
                    IndexingServer.sendResponse(httpExchange, 403, "{\"error\": \"Forbidden: Anda tidak berhak menghapus file ini\"}");
                    return;
                }

                File file = new File(IndexingServer.UPLOAD_DIR, Paths.get(filename).getFileName().toString());
                if (file.exists() && file.isFile()) {
                    if (file.delete()) {
                        try { Files.deleteIfExists(ownerPath); } catch (Exception e) {}
                        IndexingServer.log("INFO", "File dihapus secara lokal: " + filename);
                        IndexingServer.sendResponse(httpExchange, 200, "{\"status\": \"success\"}");
                    } else {
                        IndexingServer.sendResponse(httpExchange, 500, "{\"error\": \"Gagal menghapus file\"}");
                    }
                } else {
                    IndexingServer.sendResponse(httpExchange, 404, "{\"error\": \"File not found\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler paling vital untuk streaming lagu. 
     * Mendukung protokol HTTP 206 Partial Content yang memungkinkan audio player 
     * di browser untuk melompati (seek) lagu tanpa harus mendownload keseluruhan file (anti-buffer).
     */
    static class MusicServeHandler
    implements HttpHandler {
        MusicServeHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("GET".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                String string = httpExchange.getRequestURI().getPath();
                String string2 = string.substring("/music/".length());
                string2 = URLDecoder.decode(string2, StandardCharsets.UTF_8.name());
                File file = new File(IndexingServer.UPLOAD_DIR, string2 = Paths.get(string2, new String[0]).getFileName().toString());
                if (file.exists() && file.isFile()) {
                    String string3 = IndexingServer.getMimeType(string2);
                    long fileLength = file.length();
                    String rangeHeader = httpExchange.getRequestHeaders().getFirst("Range");
                    long start = 0;
                    long end = fileLength - 1;
                    boolean isPartial = false;

                    if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                        String rangeStr = rangeHeader.substring(6);
                        String[] bounds = rangeStr.split("-");
                        try {
                            if (bounds.length > 0 && !bounds[0].isEmpty()) {
                                start = Long.parseLong(bounds[0]);
                            }
                            if (bounds.length > 1 && !bounds[1].isEmpty()) {
                                end = Long.parseLong(bounds[1]);
                            }
                        } catch (NumberFormatException e) {
                            // ignore
                        }
                        if (start > end || start >= fileLength) {
                            httpExchange.getResponseHeaders().add("Content-Range", "bytes */" + fileLength);
                            IndexingServer.sendResponse(httpExchange, 416, "Requested Range Not Satisfiable");
                            return;
                        }
                        isPartial = true;
                    }

                    long contentLength = end - start + 1;
                    httpExchange.getResponseHeaders().add("Content-Type", string3);
                    httpExchange.getResponseHeaders().add("Accept-Ranges", "bytes");

                    if (isPartial) {
                        httpExchange.getResponseHeaders().add("Content-Range", "bytes " + start + "-" + end + "/" + fileLength);
                        httpExchange.sendResponseHeaders(206, contentLength);
                    } else {
                        httpExchange.getResponseHeaders().add("Content-Disposition", "inline; filename=\"" + string2 + "\"");
                        httpExchange.sendResponseHeaders(200, contentLength);
                    }

                    try (OutputStream outputStream = httpExchange.getResponseBody();
                         FileInputStream fileInputStream = new FileInputStream(file)) {
                        
                        if (start > 0) {
                            fileInputStream.skip(start);
                        }
                        
                        long bytesRemaining = contentLength;
                        byte[] byArray = new byte[8192];
                        while (bytesRemaining > 0) {
                            int toRead = (int) Math.min((long) byArray.length, bytesRemaining);
                            int n = fileInputStream.read(byArray, 0, toRead);
                            if (n == -1) break;
                            outputStream.write(byArray, 0, n);
                            bytesRemaining -= n;
                        }
                    }
                    IndexingServer.log("STREAM", "Serving file '" + string2 + "' (" + file.length() / 1024L + " KB)");
                } else {
                    IndexingServer.log("ERROR", "File tidak ditemukan: " + string2);
                    IndexingServer.sendResponse(httpExchange, 404, "{\"error\": \"File not found\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler untuk mendapatkan daftar semua Playlist yang pernah dibuat.
     */

    static class PlaylistsListHandler
    implements HttpHandler {
        PlaylistsListHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("GET".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                StringBuilder stringBuilder = new StringBuilder("{\"playlists\": [");
                int n = 0;
                for (Playlist playlist : playlists.values()) {
                    if (n > 0) {
                        stringBuilder.append(", ");
                    }
                    long l = System.currentTimeMillis();
                    stringBuilder.append("{").append("\"id\": \"").append(IndexingServer.escapeJson(playlist.id)).append("\", ").append("\"name\": \"").append(IndexingServer.escapeJson(playlist.name)).append("\", ").append("\"ownerNodeId\": \"").append(IndexingServer.escapeJson(playlist.ownerNodeId)).append("\", ").append("\"songCount\": ").append(playlist.songs.size()).append(", ").append("\"createdAt\": ").append(playlist.createdAt).append(", ").append("\"viewers\": [");
                    int n2 = 0;
                    for (Map.Entry<String, Long> entry : playlist.activeViewers.entrySet()) {
                        if (l - entry.getValue() >= 15000L) continue;
                        if (n2 > 0) {
                            stringBuilder.append(", ");
                        }
                        stringBuilder.append("\"").append(IndexingServer.escapeJson(entry.getKey())).append("\"");
                        ++n2;
                    }
                    stringBuilder.append("]}");
                    ++n;
                }
                stringBuilder.append("]}");
                IndexingServer.sendResponse(httpExchange, 200, stringBuilder.toString());
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler untuk membuat Playlist baru dan menyimpannya ke memori dan file .dat.
     */

    static class PlaylistCreateHandler
    implements HttpHandler {
        PlaylistCreateHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("POST".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                String string = new String(httpExchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                String string2 = IndexingServer.extractJsonValue(string, "name");
                String string3 = IndexingServer.extractJsonValue(string, "nodeId");
                if (string2 != null && string3 != null) {
                    String string4 = "PL-" + String.format("%03d", playlistIdCounter.getAndIncrement());
                    Playlist playlist = new Playlist(string4, string2, string3);
                    playlists.put(string4, playlist);
                    IndexingServer.savePlaylists();
                    activePeers.put(string3, System.currentTimeMillis());
                    IndexingServer.log("PLAYLIST", string3 + " membuat playlist '" + string2 + "' (ID: " + string4 + ")");
                    IndexingServer.sendResponse(httpExchange, 200, "{\"status\": \"success\", \"playlistId\": \"" + IndexingServer.escapeJson(string4) + "\", \"name\": \"" + IndexingServer.escapeJson(string2) + "\"}");
                } else {
                    IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Missing name or nodeId\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler untuk menambahkan lagu baru ke dalam Playlist tertentu.
     */

    static class PlaylistAddSongHandler
    implements HttpHandler {
        PlaylistAddSongHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("POST".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                String string = new String(httpExchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                String string2 = IndexingServer.extractJsonValue(string, "playlistId");
                String string3 = IndexingServer.extractJsonValue(string, "filename");
                if (string2 != null && string3 != null) {
                    Playlist playlist = playlists.get(string2);
                    if (playlist != null) {
                        if (!playlist.songs.contains(string3)) {
                            playlist.songs.add(string3);
                            IndexingServer.savePlaylists();
                            IndexingServer.log("PLAYLIST", "Lagu '" + string3 + "' ditambahkan ke playlist '" + playlist.name + "'");
                            IndexingServer.sendResponse(httpExchange, 200, "{\"status\": \"success\"}");
                        } else {
                            IndexingServer.sendResponse(httpExchange, 200, "{\"status\": \"duplicate\", \"message\": \"Song already in playlist\"}");
                        }
                    } else {
                        IndexingServer.sendResponse(httpExchange, 404, "{\"error\": \"Playlist not found\"}");
                    }
                } else {
                    IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Missing playlistId or filename\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler untuk menghapus lagu dari dalam Playlist.
     */

    static class PlaylistRemoveSongHandler
    implements HttpHandler {
        PlaylistRemoveSongHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("POST".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                String string = new String(httpExchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                String string2 = IndexingServer.extractJsonValue(string, "playlistId");
                String string3 = IndexingServer.extractJsonValue(string, "filename");
                if (string2 != null && string3 != null) {
                    Playlist playlist = playlists.get(string2);
                    if (playlist != null) {
                        playlist.songs.remove(string3);
                        IndexingServer.savePlaylists();
                        IndexingServer.log("PLAYLIST", "Lagu '" + string3 + "' dihapus dari playlist '" + playlist.name + "'");
                        IndexingServer.sendResponse(httpExchange, 200, "{\"status\": \"success\"}");
                    } else {
                        IndexingServer.sendResponse(httpExchange, 404, "{\"error\": \"Playlist not found\"}");
                    }
                } else {
                    IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Missing playlistId or filename\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }
    /**
     * Handler untuk mengambil daftar lagu spesifik yang ada di dalam sebuah Playlist.
     */

    static class PlaylistSongsHandler
    implements HttpHandler {
        PlaylistSongsHandler() {
        }

        @Override
        public void handle(HttpExchange httpExchange) throws IOException {
            if (IndexingServer.handleCORS(httpExchange)) {
                return;
            }
            if ("GET".equalsIgnoreCase(httpExchange.getRequestMethod())) {
                String string = httpExchange.getRequestURI().getQuery();
                String string2 = IndexingServer.extractQueryParam(string, "id");
                if (string2 != null) {
                    Playlist playlist = playlists.get(string2);
                    if (playlist != null) {
                        StringBuilder stringBuilder = new StringBuilder("{");
                        stringBuilder.append("\"id\": \"").append(IndexingServer.escapeJson(playlist.id)).append("\", ");
                        stringBuilder.append("\"name\": \"").append(IndexingServer.escapeJson(playlist.name)).append("\", ");
                        stringBuilder.append("\"ownerNodeId\": \"").append(IndexingServer.escapeJson(playlist.ownerNodeId)).append("\", ");
                        stringBuilder.append("\"createdAt\": ").append(playlist.createdAt).append(", ");
                        stringBuilder.append("\"songs\": [");
                        for (int i = 0; i < playlist.songs.size(); ++i) {
                            if (i > 0) {
                                stringBuilder.append(", ");
                            }
                            String string3 = playlist.songs.get(i);
                            boolean bl = new File(IndexingServer.UPLOAD_DIR, string3).exists();
                            stringBuilder.append("{\"filename\": \"").append(IndexingServer.escapeJson(string3)).append("\", \"existsOnServer\": ").append(bl).append("}");
                        }
                        stringBuilder.append("], ");
                        String string4 = IndexingServer.extractQueryParam(string, "viewerId");
                        long l = System.currentTimeMillis();
                        if (string4 != null && !string4.isEmpty()) {
                            playlist.activeViewers.put(string4, l);
                        }
                        stringBuilder.append("\"viewers\": [");
                        int n = 0;
                        for (Map.Entry<String, Long> entry : playlist.activeViewers.entrySet()) {
                            if (l - entry.getValue() < 15000L) {
                                if (n > 0) {
                                    stringBuilder.append(", ");
                                }
                                stringBuilder.append("\"").append(IndexingServer.escapeJson(entry.getKey())).append("\"");
                                ++n;
                                continue;
                            }
                            playlist.activeViewers.remove(entry.getKey());
                        }
                        stringBuilder.append("]}");
                        IndexingServer.sendResponse(httpExchange, 200, stringBuilder.toString());
                    } else {
                        IndexingServer.sendResponse(httpExchange, 404, "{\"error\": \"Playlist not found\"}");
                    }
                } else {
                    IndexingServer.sendResponse(httpExchange, 400, "{\"error\": \"Missing id parameter\"}");
                }
            } else {
                IndexingServer.sendResponse(httpExchange, 405, "{\"error\": \"Method not allowed\"}");
            }
        }
    }

    static class Playlist
    implements Serializable {
        private static final long serialVersionUID = 1L;
        String id;
        String name;
        String ownerNodeId;
        long createdAt;
        List<String> songs = Collections.synchronizedList(new ArrayList());
        transient ConcurrentHashMap<String, Long> activeViewers = new ConcurrentHashMap();

        Playlist(String string, String string2, String string3) {
            this.id = string;
            this.name = string2;
            this.ownerNodeId = string3;
            this.createdAt = System.currentTimeMillis();
        }

        private void readObject(ObjectInputStream objectInputStream) throws IOException, ClassNotFoundException {
            objectInputStream.defaultReadObject();
            this.activeViewers = new ConcurrentHashMap();
        }
    }
}
