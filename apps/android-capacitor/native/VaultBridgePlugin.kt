package com.sexta.assistant

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedReader
import java.io.InputStreamReader

@CapacitorPlugin(name = "VaultBridge")
class VaultBridgePlugin : Plugin() {
    private val prefsName = "sexta_vault"
    private val uriKey = "vault_tree_uri"

    private fun prefs() = context.getSharedPreferences(prefsName, 0)
    private fun savedUri(): Uri? = prefs().getString(uriKey, null)?.let(Uri::parse)
    private fun root(): DocumentFile? = savedUri()?.let { DocumentFile.fromTreeUri(context, it) }

    @PluginMethod
    fun chooseVault(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "vaultPicked")
    }

    @ActivityCallback
    private fun vaultPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK || result.data?.data == null) {
            val ret = JSObject(); ret.put("ok", false); ret.put("canceled", true); call.resolve(ret); return
        }
        val uri = result.data!!.data!!
        val flags = result.data!!.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        try { context.contentResolver.takePersistableUriPermission(uri, flags) } catch (_: Exception) {}
        prefs().edit().putString(uriKey, uri.toString()).apply()
        val tree = DocumentFile.fromTreeUri(context, uri)
        val ret = JSObject(); ret.put("ok", true); ret.put("configured", true); ret.put("treeName", tree?.name ?: "SEXTA"); ret.put("uri", uri.toString()); call.resolve(ret)
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val tree = root()
        val ret = JSObject(); ret.put("configured", tree != null && tree.exists()); ret.put("treeName", tree?.name ?: ""); ret.put("uri", savedUri()?.toString() ?: ""); call.resolve(ret)
    }

    @PluginMethod
    fun readNotes(call: PluginCall) {
        val tree = root() ?: run { val ret=JSObject();ret.put("configured",false);ret.put("notes",JSArray());call.resolve(ret);return }
        val notes = JSArray()
        walk(tree, "", notes)
        val ret = JSObject(); ret.put("configured", true); ret.put("treeName", tree.name ?: "SEXTA"); ret.put("notes", notes); call.resolve(ret)
    }

    private fun walk(dir: DocumentFile, prefix: String, out: JSArray) {
        dir.listFiles().forEach { file ->
            val name = file.name ?: return@forEach
            if (name == ".obsidian" || name == ".trash" || name.startsWith(".git")) return@forEach
            val rel = if (prefix.isBlank()) name else "$prefix/$name"
            if (file.isDirectory) walk(file, rel, out)
            else if (file.isFile && name.lowercase().endsWith(".md")) {
                val text = context.contentResolver.openInputStream(file.uri)?.use { stream ->
                    BufferedReader(InputStreamReader(stream)).readText()
                } ?: ""
                val item = JSObject(); item.put("path", rel); item.put("markdown", text); item.put("clientUpdatedAt", java.time.Instant.ofEpochMilli(file.lastModified()).toString()); item.put("size", file.length()); out.put(item)
            }
        }
    }

    @PluginMethod
    fun writeNotes(call: PluginCall) {
        val tree = root() ?: run { call.reject("VAULT_NOT_CONFIGURED"); return }
        val notes = call.getArray("notes") ?: JSArray()
        var written = 0
        for (i in 0 until notes.length()) {
            val note = notes.getJSONObject(i)
            val rel = sanitize(note.optString("path")) ?: continue
            val markdown = note.optString("markdown", "")
            val parts = rel.split("/")
            var dir = tree
            for (part in parts.dropLast(1)) {
                dir = dir.findFile(part)?.takeIf { it.isDirectory } ?: dir.createDirectory(part) ?: break
            }
            val name = parts.last()
            var file = dir.findFile(name)
            if (file == null) file = dir.createFile("text/markdown", name)
            if (file != null) {
                val current = context.contentResolver.openInputStream(file.uri)?.use { BufferedReader(InputStreamReader(it)).readText() }
                if (current != markdown) {
                    context.contentResolver.openOutputStream(file.uri, "wt")?.bufferedWriter()?.use { it.write(markdown) }
                    written++
                }
            }
        }
        val ret = JSObject(); ret.put("ok", true); ret.put("written", written); ret.put("treeName", tree.name ?: "SEXTA"); call.resolve(ret)
    }

    private fun sanitize(value: String): String? {
        val rel = value.replace('\\','/').trimStart('/')
        if (rel.isBlank() || !rel.lowercase().endsWith(".md")) return null
        val parts = rel.split('/').filter { it.isNotBlank() }
        if (parts.any { it == "." || it == ".." }) return null
        return parts.joinToString("/")
    }

    @PluginMethod
    fun openObsidian(call: PluginCall) {
        val tree = root() ?: run { call.reject("VAULT_NOT_CONFIGURED"); return }
        val vaultName = Uri.encode(tree.name ?: "SEXTA")
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("obsidian://open?vault=$vaultName")).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        try { context.startActivity(intent); val ret=JSObject();ret.put("ok",true);call.resolve(ret) }
        catch (e: Exception) { call.reject("OBSIDIAN_NOT_INSTALLED", e) }
    }
}
