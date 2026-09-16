package com.pogmail.android.data.cache

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.room.Upsert
import androidx.room.withTransaction
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "cached_mailboxes")
data class CachedMailbox(
    @PrimaryKey val id: String,
    val address: String,
    val displayName: String?,
    val source: String,
    val disabled: Boolean,
)

@Entity(tableName = "cached_folders")
data class CachedFolder(
    @PrimaryKey val id: String,
    val mailboxId: String,
    val name: String,
    val color: String?,
    val position: Int,
)

/** Deliberately excludes body text, HTML, raw MIME and attachment contents. */
@Entity(tableName = "cached_messages")
data class CachedMessage(
    @PrimaryKey val id: String,
    val mailboxId: String,
    val folderId: String?,
    val status: String,
    val snoozedUntil: Long?,
    val subject: String?,
    val fromAddress: String,
    val fromName: String?,
    val snippet: String?,
    val receivedAt: Long,
    val read: Boolean,
    val starred: Boolean,
    val hasAttachments: Boolean,
)

@Entity(tableName = "sync_state")
data class SyncState(@PrimaryKey val key: String, val cursor: Long)

@Dao
interface MailCacheDao {
    @Upsert suspend fun upsertMailboxes(items: List<CachedMailbox>)
    @Upsert suspend fun upsertFolders(items: List<CachedFolder>)
    @Upsert suspend fun upsertMessages(items: List<CachedMessage>)
    @Upsert suspend fun saveState(state: SyncState)
    @Query("SELECT cursor FROM sync_state WHERE `key` = :key") suspend fun cursor(key: String): Long?
    @Query("SELECT * FROM cached_messages ORDER BY receivedAt DESC") fun observeMessages(): Flow<List<CachedMessage>>
    @Query("SELECT * FROM cached_folders ORDER BY position ASC, name ASC") fun observeFolders(): Flow<List<CachedFolder>>
    @Query("UPDATE cached_messages SET read = :read, starred = :starred, status = :status, folderId = :folderId, snoozedUntil = :snoozedUntil WHERE id = :id")
    suspend fun setMessageState(id: String, read: Boolean, starred: Boolean, status: String, folderId: String?, snoozedUntil: Long?)
    @Query("DELETE FROM cached_messages WHERE id IN (:ids)") suspend fun deleteMessages(ids: List<String>)
    @Query("DELETE FROM cached_folders WHERE id IN (:ids)") suspend fun deleteFolders(ids: List<String>)
    @Query("DELETE FROM cached_mailboxes WHERE id IN (:ids)") suspend fun deleteMailboxes(ids: List<String>)
    @Query("DELETE FROM cached_messages") suspend fun clearMessages()
    @Query("DELETE FROM cached_folders") suspend fun clearFolders()
    @Query("DELETE FROM cached_mailboxes") suspend fun clearMailboxes()
    @Query("DELETE FROM sync_state") suspend fun clearSyncState()
}

@Database(entities = [CachedMailbox::class, CachedFolder::class, CachedMessage::class, SyncState::class], version = 2, exportSchema = true)
abstract class MailCacheDatabase : RoomDatabase() {
    abstract fun dao(): MailCacheDao

    suspend fun apply(batch: MailSyncBatch) = withTransaction {
        dao().upsertMailboxes(batch.mailboxes)
        dao().upsertFolders(batch.folders)
        dao().upsertMessages(batch.messages)
        dao().deleteMessages(batch.deletedMessageIds)
        dao().deleteFolders(batch.deletedFolderIds)
        dao().deleteMailboxes(batch.deletedMailboxIds)
        dao().saveState(SyncState(SYNC_CURSOR_KEY, batch.cursor))
    }

    suspend fun clear() = withTransaction {
        dao().clearMessages()
        dao().clearFolders()
        dao().clearMailboxes()
        dao().clearSyncState()
    }

    companion object {
        const val SYNC_CURSOR_KEY = "mobile_sync_cursor"

        fun create(context: Context): MailCacheDatabase = Room.databaseBuilder(
            context,
            MailCacheDatabase::class.java,
            "pogmail_mail_cache",
        ).addMigrations(MIGRATION_1_2).build()

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // The cache can always be rehydrated, but retaining it avoids a blank
                // inbox after upgrading the client.
                db.execSQL("ALTER TABLE cached_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'received'")
                db.execSQL("ALTER TABLE cached_messages ADD COLUMN snoozedUntil INTEGER")
            }
        }
    }
}

data class MailSyncBatch(
    val cursor: Long,
    val hasMore: Boolean,
    val mailboxes: List<CachedMailbox>,
    val folders: List<CachedFolder>,
    val messages: List<CachedMessage>,
    val deletedMailboxIds: List<String>,
    val deletedFolderIds: List<String>,
    val deletedMessageIds: List<String>,
)
