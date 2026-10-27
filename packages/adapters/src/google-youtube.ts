import { z } from "zod";
import { type GoogleApi, GoogleApiError } from "./google-api.js";
import {
  definedFields,
  type GoogleServiceDefinition,
  googleOperation,
  googleScope,
  readWorkspaceFile,
} from "./google-tools.js";

const YOUTUBE = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

type Video = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    tags?: string[];
    categoryId?: string;
    publishedAt?: string;
    channelId?: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
  };
  status?: {
    uploadStatus?: string;
    privacyStatus?: string;
    publishAt?: string;
    selfDeclaredMadeForKids?: boolean;
    madeForKids?: boolean;
    embeddable?: boolean;
    license?: string;
    publicStatsViewable?: boolean;
    rejectionReason?: string;
    failureReason?: string;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
  processingDetails?: { processingStatus?: string };
};

function video(item: Video) {
  return definedFields({
    id: item.id,
    url: item.id ? `https://youtu.be/${item.id}` : undefined,
    title: item.snippet?.title,
    description: item.snippet?.description ? item.snippet.description.slice(0, 500) : undefined,
    published: item.snippet?.publishedAt,
    privacy: item.status?.privacyStatus,
    publish_at: item.status?.publishAt,
    upload_status: item.status?.uploadStatus,
    processing: item.processingDetails?.processingStatus,
    problem: item.status?.rejectionReason ?? item.status?.failureReason,
    made_for_kids: item.status?.madeForKids,
    duration: item.contentDetails?.duration,
    views: item.statistics?.viewCount ? Number(item.statistics.viewCount) : undefined,
    likes: item.statistics?.likeCount ? Number(item.statistics.likeCount) : undefined,
    comments: item.statistics?.commentCount ? Number(item.statistics.commentCount) : undefined,
  });
}

async function videosById(api: GoogleApi, ids: string[]): Promise<Video[]> {
  if (ids.length === 0) return [];
  const listed = await api.json<{ items?: Video[] }>({
    url: `${YOUTUBE}/videos`,
    query: {
      part: "snippet,status,statistics,contentDetails,processingDetails",
      id: ids.join(","),
      maxResults: 50,
    },
  });
  return listed.items ?? [];
}

// YouTube rejects angle brackets in titles and descriptions.
const Title = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/[<>]/.test(value), { message: "Title cannot contain < or >" });
const Description = z
  .string()
  .max(5_000)
  .refine((value) => !/[<>]/.test(value), { message: "Description cannot contain < or >" });
const Tags = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .refine((tags) => tags.join(",").length <= 500, { message: "Tags may total 500 characters" });
const Privacy = z.enum(["private", "unlisted", "public"]);
const PublishAt = z
  .string()
  .max(40)
  .refine((value) => Number.isFinite(Date.parse(value)), { message: "publish_at must be ISO 8601" })
  .describe("Publish time; the video stays private until then");

const read = {
  id: "read",
  label: "See your channel and videos",
  scopes: [googleScope("youtube.readonly")],
  coveredBy: [googleScope("youtube"), googleScope("youtube.force-ssl")],
};
const upload = {
  id: "upload",
  label: "Upload videos and thumbnails",
  scopes: [googleScope("youtube.upload")],
  coveredBy: [googleScope("youtube"), googleScope("youtube.force-ssl")],
};
const manage = {
  id: "manage",
  label: "Edit videos, playlists, and comments",
  scopes: [googleScope("youtube.force-ssl")],
};

export const youtubeService: GoogleServiceDefinition = {
  slug: "youtube",
  name: "YouTube",
  description: "Upload and manage your channel's videos",
  permissions: [read, upload, manage],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "youtube_list_channels",
      description: "List the YouTube channels of this Google account.",
      requires: ["read"],
      readOnly: true,
      input: z.object({}),
      async run(_input, { api }) {
        const listed = await api.json<{
          items?: Array<{
            id?: string;
            snippet?: { title?: string; customUrl?: string };
            statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string };
            contentDetails?: { relatedPlaylists?: { uploads?: string } };
          }>;
        }>({
          url: `${YOUTUBE}/channels`,
          query: { part: "snippet,statistics,contentDetails", mine: true },
        });
        return {
          channels: (listed.items ?? []).map((channel) =>
            definedFields({
              id: channel.id,
              title: channel.snippet?.title,
              handle: channel.snippet?.customUrl,
              subscribers: channel.statistics?.subscriberCount
                ? Number(channel.statistics.subscriberCount)
                : undefined,
              videos: channel.statistics?.videoCount
                ? Number(channel.statistics.videoCount)
                : undefined,
              views: channel.statistics?.viewCount
                ? Number(channel.statistics.viewCount)
                : undefined,
              uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads,
            }),
          ),
        };
      },
    }),
    googleOperation({
      name: "youtube_list_my_videos",
      description: "List this channel's uploads, newest first, with privacy and processing status.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        max_results: z.number().int().min(1).max(50).default(20),
        page_token: z.string().max(500).optional(),
      }),
      async run(input, { api }) {
        const channels = await api.json<{
          items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
        }>({ url: `${YOUTUBE}/channels`, query: { part: "contentDetails", mine: true } });
        const uploads = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (!uploads) return { videos: [] };
        const page = await api.json<{
          items?: Array<{ contentDetails?: { videoId?: string } }>;
          nextPageToken?: string;
        }>({
          url: `${YOUTUBE}/playlistItems`,
          query: {
            part: "contentDetails",
            playlistId: uploads,
            maxResults: input.max_results,
            pageToken: input.page_token,
          },
        });
        const ids = (page.items ?? [])
          .map((item) => item.contentDetails?.videoId)
          .filter((id): id is string => Boolean(id));
        return {
          videos: (await videosById(api, ids)).map(video),
          ...(page.nextPageToken ? { next_page_token: page.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "youtube_get_video",
      description: "Get details, privacy, processing status, and statistics for videos by id.",
      requires: ["read"],
      readOnly: true,
      input: z.object({ video_ids: z.array(z.string().min(1).max(64)).min(1).max(50) }),
      async run(input, { api }) {
        return { videos: (await videosById(api, input.video_ids)).map(video) };
      },
    }),
    googleOperation({
      name: "youtube_search_videos",
      description:
        "Search public YouTube videos. Each search costs far more API quota than other reads, so search sparingly.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        query: z.string().min(1).max(500),
        channel_id: z.string().max(64).optional(),
        order: z.enum(["relevance", "date", "viewCount", "rating"]).default("relevance"),
        max_results: z.number().int().min(1).max(25).default(10),
        page_token: z.string().max(500).optional(),
      }),
      async run(input, { api }) {
        const results = await api.json<{
          items?: Array<{
            id?: { videoId?: string };
            snippet?: {
              title?: string;
              channelTitle?: string;
              publishedAt?: string;
              description?: string;
            };
          }>;
          nextPageToken?: string;
        }>({
          url: `${YOUTUBE}/search`,
          query: {
            part: "snippet",
            type: "video",
            q: input.query,
            channelId: input.channel_id,
            order: input.order,
            maxResults: input.max_results,
            pageToken: input.page_token,
          },
        });
        return {
          videos: (results.items ?? []).map((item) =>
            definedFields({
              id: item.id?.videoId,
              url: item.id?.videoId ? `https://youtu.be/${item.id.videoId}` : undefined,
              title: item.snippet?.title,
              channel: item.snippet?.channelTitle,
              published: item.snippet?.publishedAt,
              description: item.snippet?.description,
            }),
          ),
          ...(results.nextPageToken ? { next_page_token: results.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "youtube_upload_video",
      description:
        "Upload a video file from the bot's computer to this account's channel. Videos upload as private unless privacy_status says otherwise; publish_at schedules a private video to go public. Google Cloud projects that have not passed YouTube's API audit can only publish private videos.",
      requires: ["upload"],
      readOnly: false,
      tracked: true,
      input: z.object({
        file_path: z.string().min(1).max(1_024).describe("Video file on the bot's computer"),
        title: Title,
        description: Description.default(""),
        tags: Tags.optional(),
        category_id: z.string().regex(/^\d+$/).max(4).default("22").describe("YouTube category id"),
        privacy_status: Privacy.default("private"),
        publish_at: PublishAt.optional(),
        made_for_kids: z
          .boolean()
          .describe("Whether the video is made for children (required by law)"),
        notify_subscribers: z.boolean().default(true),
        thumbnail_path: z.string().min(1).max(1_024).optional().describe("JPEG or PNG under 2 MB"),
      }),
      async run(input, context) {
        if (input.publish_at && Date.parse(input.publish_at) <= Date.now()) {
          throw new Error("publish_at must be in the future.");
        }
        const file = await readWorkspaceFile(context, input.file_path);
        const thumbnail = input.thumbnail_path
          ? await readWorkspaceFile(context, input.thumbnail_path, MAX_THUMBNAIL_BYTES)
          : undefined;
        await context.progress("Uploading");
        const uploaded = (await context.api.resumableUpload({
          url: `${YOUTUBE_UPLOAD}/videos`,
          query: {
            part: "snippet,status",
            notifySubscribers: input.notify_subscribers,
          },
          metadata: {
            snippet: definedFields({
              title: input.title,
              description: input.description,
              tags: input.tags,
              categoryId: input.category_id,
            }),
            status: definedFields({
              // A scheduled video must be private until its publish time.
              privacyStatus: input.publish_at ? "private" : input.privacy_status,
              publishAt: input.publish_at ? new Date(input.publish_at).toISOString() : undefined,
              selfDeclaredMadeForKids: input.made_for_kids,
            }),
          },
          bytes: file.bytes,
          mimeType: file.mimeType.startsWith("video/") ? file.mimeType : "application/octet-stream",
          onProgress: (done, total) =>
            context.progress(`${Math.floor((done / total) * 100)}% uploaded`),
        })) as Video;
        let thumbnailError: string | undefined;
        if (thumbnail && uploaded.id) {
          try {
            await setThumbnail(context.api, uploaded.id, thumbnail);
          } catch (error) {
            thumbnailError = error instanceof Error ? error.message : String(error);
          }
        }
        return definedFields({
          ...video(uploaded),
          thumbnail: thumbnail ? (thumbnailError ? undefined : "set") : undefined,
          thumbnail_error: thumbnailError,
        });
      },
    }),
    googleOperation({
      name: "youtube_set_thumbnail",
      description: "Set a video's custom thumbnail from a JPEG or PNG on the bot's computer.",
      requires: ["upload"],
      readOnly: false,
      input: z.object({
        video_id: z.string().min(1).max(64),
        file_path: z.string().min(1).max(1_024),
      }),
      async run(input, context) {
        const image = await readWorkspaceFile(context, input.file_path, MAX_THUMBNAIL_BYTES);
        await setThumbnail(context.api, input.video_id, image);
        return { video_id: input.video_id, thumbnail: "set" };
      },
    }),
    googleOperation({
      name: "youtube_update_video",
      description:
        "Change a video's title, description, tags, category, privacy, or scheduled publish time. Unpassed fields keep their values.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({
        video_id: z.string().min(1).max(64),
        title: Title.optional(),
        description: Description.optional(),
        tags: Tags.optional(),
        category_id: z.string().regex(/^\d+$/).max(4).optional(),
        privacy_status: Privacy.optional(),
        publish_at: PublishAt.optional(),
        made_for_kids: z.boolean().optional(),
      }),
      async run(input, { api }) {
        const [current] = await videosById(api, [input.video_id]);
        if (!current?.snippet || !current.status)
          throw new Error("Video not found on this channel.");
        // videos.update replaces each part wholesale, so unchanged fields are sent back as they are.
        const updated = await api.json<Video>({
          method: "PUT",
          url: `${YOUTUBE}/videos`,
          query: { part: "snippet,status" },
          json: {
            id: input.video_id,
            snippet: definedFields({
              title: input.title ?? current.snippet.title,
              description: input.description ?? current.snippet.description,
              tags: input.tags ?? current.snippet.tags,
              categoryId: input.category_id ?? current.snippet.categoryId,
              defaultLanguage: current.snippet.defaultLanguage,
              defaultAudioLanguage: current.snippet.defaultAudioLanguage,
            }),
            status: definedFields({
              privacyStatus: input.publish_at
                ? "private"
                : (input.privacy_status ?? current.status.privacyStatus),
              publishAt: input.publish_at
                ? new Date(input.publish_at).toISOString()
                : input.privacy_status
                  ? undefined
                  : current.status.publishAt,
              selfDeclaredMadeForKids:
                input.made_for_kids ?? current.status.selfDeclaredMadeForKids,
              embeddable: current.status.embeddable,
              license: current.status.license,
              publicStatsViewable: current.status.publicStatsViewable,
            }),
          },
          idempotent: true,
        });
        return video(updated);
      },
    }),
    googleOperation({
      name: "youtube_delete_video",
      description: "Permanently delete a video from this channel.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({ video_id: z.string().min(1).max(64) }),
      async run(input, { api }) {
        await api.request({
          method: "DELETE",
          url: `${YOUTUBE}/videos`,
          query: { id: input.video_id },
          responseType: "none",
        });
        return { deleted: true, video_id: input.video_id };
      },
    }),
    googleOperation({
      name: "youtube_list_playlists",
      description: "List this channel's playlists.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        max_results: z.number().int().min(1).max(50).default(25),
        page_token: z.string().max(500).optional(),
      }),
      async run(input, { api }) {
        const listed = await api.json<{
          items?: Array<{
            id?: string;
            snippet?: { title?: string };
            status?: { privacyStatus?: string };
            contentDetails?: { itemCount?: number };
          }>;
          nextPageToken?: string;
        }>({
          url: `${YOUTUBE}/playlists`,
          query: {
            part: "snippet,status,contentDetails",
            mine: true,
            maxResults: input.max_results,
            pageToken: input.page_token,
          },
        });
        return {
          playlists: (listed.items ?? []).map((item) => ({
            id: item.id,
            title: item.snippet?.title,
            privacy: item.status?.privacyStatus,
            videos: item.contentDetails?.itemCount,
          })),
          ...(listed.nextPageToken ? { next_page_token: listed.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "youtube_create_playlist",
      description: "Create a playlist on this channel.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({
        title: Title,
        description: Description.optional(),
        privacy_status: Privacy.default("private"),
      }),
      async run(input, { api }) {
        const created = await api.json<{ id?: string; snippet?: { title?: string } }>({
          method: "POST",
          url: `${YOUTUBE}/playlists`,
          query: { part: "snippet,status" },
          json: {
            snippet: definedFields({ title: input.title, description: input.description }),
            status: { privacyStatus: input.privacy_status },
          },
        });
        return { id: created.id, title: created.snippet?.title };
      },
    }),
    googleOperation({
      name: "youtube_add_video_to_playlist",
      description: "Add a video to one of this channel's playlists.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({
        playlist_id: z.string().min(1).max(64),
        video_id: z.string().min(1).max(64),
        position: z.number().int().min(0).optional(),
      }),
      async run(input, { api }) {
        const item = await api.json<{ id?: string }>({
          method: "POST",
          url: `${YOUTUBE}/playlistItems`,
          query: { part: "snippet" },
          json: {
            snippet: definedFields({
              playlistId: input.playlist_id,
              resourceId: { kind: "youtube#video", videoId: input.video_id },
              position: input.position,
            }),
          },
        });
        return { playlist_item_id: item.id };
      },
    }),
    googleOperation({
      name: "youtube_list_comments",
      description: "List top-level comments and their first replies on a video.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        video_id: z.string().min(1).max(64),
        order: z.enum(["time", "relevance"]).default("time"),
        max_results: z.number().int().min(1).max(50).default(20),
        page_token: z.string().max(500).optional(),
      }),
      async run(input, { api }) {
        type Comment = {
          id?: string;
          snippet?: {
            authorDisplayName?: string;
            textDisplay?: string;
            likeCount?: number;
            publishedAt?: string;
          };
        };
        const listed = await api.json<{
          items?: Array<{
            id?: string;
            snippet?: { topLevelComment?: Comment; totalReplyCount?: number };
            replies?: { comments?: Comment[] };
          }>;
          nextPageToken?: string;
        }>({
          url: `${YOUTUBE}/commentThreads`,
          query: {
            part: "snippet,replies",
            videoId: input.video_id,
            order: input.order,
            textFormat: "plainText",
            maxResults: input.max_results,
            pageToken: input.page_token,
          },
        });
        const comment = (item: Comment | undefined) =>
          definedFields({
            id: item?.id,
            author: item?.snippet?.authorDisplayName,
            text: item?.snippet?.textDisplay?.slice(0, 1_000),
            likes: item?.snippet?.likeCount,
            published: item?.snippet?.publishedAt,
          });
        return {
          comments: (listed.items ?? []).map((thread) => ({
            ...comment(thread.snippet?.topLevelComment),
            reply_count: thread.snippet?.totalReplyCount ?? 0,
            replies: (thread.replies?.comments ?? []).slice(0, 5).map(comment),
          })),
          ...(listed.nextPageToken ? { next_page_token: listed.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "youtube_reply_to_comment",
      description: "Reply publicly to a comment, as this channel.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({
        comment_id: z.string().min(1).max(200),
        text: z.string().trim().min(1).max(10_000),
      }),
      async run(input, { api }) {
        const created = await api.json<{ id?: string }>({
          method: "POST",
          url: `${YOUTUBE}/comments`,
          query: { part: "snippet" },
          json: { snippet: { parentId: input.comment_id, textOriginal: input.text } },
        });
        return { comment_id: created.id };
      },
    }),
    googleOperation({
      name: "youtube_post_comment",
      description: "Post a public top-level comment on a video, as this channel.",
      requires: ["manage"],
      readOnly: false,
      input: z.object({
        video_id: z.string().min(1).max(64),
        text: z.string().trim().min(1).max(10_000),
      }),
      async run(input, { api }) {
        const created = await api.json<{ id?: string }>({
          method: "POST",
          url: `${YOUTUBE}/commentThreads`,
          query: { part: "snippet" },
          json: {
            snippet: {
              videoId: input.video_id,
              topLevelComment: { snippet: { textOriginal: input.text } },
            },
          },
        });
        return { comment_thread_id: created.id };
      },
    }),
  ],
};

async function setThumbnail(
  api: GoogleApi,
  videoId: string,
  image: { bytes: Uint8Array; mimeType: string },
): Promise<void> {
  if (image.mimeType !== "image/jpeg" && image.mimeType !== "image/png") {
    throw new GoogleApiError("invalid", 400, "Thumbnails must be JPEG or PNG.");
  }
  await api.request({
    method: "POST",
    url: `${YOUTUBE_UPLOAD}/thumbnails/set`,
    query: { videoId, uploadType: "media" },
    headers: { "content-type": image.mimeType },
    body: image.bytes,
    responseType: "none",
    // Setting the same image twice leaves the same result.
    idempotent: true,
  });
}
