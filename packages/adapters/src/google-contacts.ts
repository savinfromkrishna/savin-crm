import { z } from "zod";
import {
  definedFields,
  type GoogleServiceDefinition,
  googleOperation,
  googleScope,
} from "./google-tools.js";

const PEOPLE = "https://people.googleapis.com/v1";
const FIELDS = "names,emailAddresses,phoneNumbers,organizations";

type Person = {
  resourceName?: string;
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
};

function person(item: Person) {
  const organization = item.organizations?.[0];
  return definedFields({
    id: item.resourceName,
    name: item.names?.[0]?.displayName,
    emails: item.emailAddresses?.map((email) => email.value).filter(Boolean),
    phones: item.phoneNumbers?.map((phone) => phone.value).filter(Boolean),
    organization: organization?.name,
    job_title: organization?.title,
  });
}

const read = {
  id: "read",
  label: "See contacts",
  scopes: [googleScope("contacts.readonly")],
  coveredBy: [googleScope("contacts")],
};
const write = { id: "write", label: "Create contacts", scopes: [googleScope("contacts")] };

export const contactsService: GoogleServiceDefinition = {
  slug: "google_contacts",
  name: "Google Contacts",
  description: "Look up and add contacts",
  permissions: [read, write],
  defaultPermissions: ["read"],
  operations: [
    googleOperation({
      name: "google_contacts_search_contacts",
      description: "Find contacts by name, email, phone, or organization.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        query: z.string().trim().min(1).max(200),
        max_results: z.number().int().min(1).max(30).default(10),
      }),
      async run(input, { api }) {
        const search = () =>
          api.json<{ results?: Array<{ person?: Person }> }>({
            url: `${PEOPLE}/people:searchContacts`,
            query: { query: input.query, readMask: FIELDS, pageSize: input.max_results },
          });
        let found = await search();
        if (!found.results?.length) {
          // Google answers from a cache that an empty query warms up.
          await api.json({
            url: `${PEOPLE}/people:searchContacts`,
            query: { query: "", readMask: FIELDS },
          });
          found = await search();
        }
        return {
          contacts: (found.results ?? []).flatMap((result) =>
            result.person ? [person(result.person)] : [],
          ),
        };
      },
    }),
    googleOperation({
      name: "google_contacts_list_contacts",
      description: "List contacts, most recently changed first.",
      requires: ["read"],
      readOnly: true,
      input: z.object({
        max_results: z.number().int().min(1).max(100).default(50),
        page_token: z.string().max(500).optional(),
      }),
      async run(input, { api }) {
        const listed = await api.json<{
          connections?: Person[];
          nextPageToken?: string;
          totalPeople?: number;
        }>({
          url: `${PEOPLE}/people/me/connections`,
          query: {
            personFields: FIELDS,
            pageSize: input.max_results,
            pageToken: input.page_token,
            sortOrder: "LAST_MODIFIED_DESCENDING",
          },
        });
        return {
          contacts: (listed.connections ?? []).map(person),
          total: listed.totalPeople,
          ...(listed.nextPageToken ? { next_page_token: listed.nextPageToken } : {}),
        };
      },
    }),
    googleOperation({
      name: "google_contacts_create_contact",
      description: "Add a contact.",
      requires: ["write"],
      readOnly: false,
      input: z.object({
        given_name: z.string().trim().min(1).max(200),
        family_name: z.string().trim().max(200).optional(),
        emails: z.array(z.email().max(320)).max(10).default([]),
        phones: z.array(z.string().trim().min(3).max(50)).max(10).default([]),
        organization: z.string().max(200).optional(),
        job_title: z.string().max(200).optional(),
      }),
      async run(input, { api }) {
        const created = await api.json<Person>({
          method: "POST",
          url: `${PEOPLE}/people:createContact`,
          query: { personFields: FIELDS },
          json: definedFields({
            names: [definedFields({ givenName: input.given_name, familyName: input.family_name })],
            emailAddresses: input.emails.length
              ? input.emails.map((value) => ({ value }))
              : undefined,
            phoneNumbers: input.phones.length
              ? input.phones.map((value) => ({ value }))
              : undefined,
            organizations:
              input.organization || input.job_title
                ? [definedFields({ name: input.organization, title: input.job_title })]
                : undefined,
          }),
        });
        return person(created);
      },
    }),
  ],
};
