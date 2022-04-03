import { SlashCommandBuilder } from "@discordjs/builders";
import { CommandInteraction, MessageAttachment } from "discord.js";
import { LunarAssistant } from "..";
import { User } from "../shared/firestoreTypes";
import { APICallError, UserDocMissingError } from "../types/errors";
import {
  getActiveInactiveRoleIds,
  propogateRoleUpdates,
} from "../utils/coldUpdateDiscordRolesForUser";
import {
  guildIdDictToGuildNameDict,
  guildRoleDictToGuildRoleNameDict,
} from "../utils/helper";

const lunarVerify = {
  data: new SlashCommandBuilder()
    .setName("lunar-view-roles")
    .setDescription(
      "View the roles that you have been granted based on the contents of your wallet."
    )
    .addBooleanOption((option) =>
      option
        .setName("private-response")
        .setDescription(
          "Indicate whether or not the response should be public or private. Private by default."
        )
    ),
  execute: async (
    lunarAssistant: LunarAssistant,
    interaction: CommandInteraction
  ) => {
    // verify the interaction is valid
    if (!interaction.guildId || !interaction.guild || !interaction.member)
      return;

    const rawPrivateResponse =
      interaction.options.getBoolean("private-response");
    const privateResponse =
      rawPrivateResponse || rawPrivateResponse == null ? true : false;

    await interaction.deferReply({ ephemeral: privateResponse });

    try {
      // get the user document
      const userDoc = await lunarAssistant.db
        .collection("users")
        .doc(interaction.user.id)
        .get();

      // check that the user document exists
      if (!userDoc.exists)
        throw new UserDocMissingError("Couldn't find user document");

      // Get the users wallet address
      const walletAddress = (userDoc.data() as User).wallet;

      // get guilds from db
      // later store this in memory for performance reasons
      const guildConfigsSnapshot = await lunarAssistant.db
        .collection("guildConfigs")
        .get();

      if (guildConfigsSnapshot.empty)
        return {
          addedRoleNames: {},
          persistedRoleNames: {},
          removedRoleNames: {},
        };

      const { activeRoles, inactiveRoles } = await getActiveInactiveRoleIds(
        lunarAssistant,
        interaction.user.id,
        walletAddress,
        guildConfigsSnapshot
      );

      const activeRoleNames = guildIdDictToGuildNameDict(
        lunarAssistant,
        guildRoleDictToGuildRoleNameDict(activeRoles)
      );

      if (Object.keys(activeRoleNames).length > 0) {
        const activeRolesMessage = Object.keys(activeRoleNames)
          .filter((guildName) => (activeRoleNames[guildName] || []).length > 0)
          .map(
            (guildName) =>
              `${guildName}: ${activeRoleNames[guildName].join(", ")}`
          )
          .join("\n");

        const message = `Hello ser! You have been granted the following roles on the following servers, updating them now.\n\n${activeRolesMessage}`;

        if (message.length > 2000) {
          await interaction.editReply({
            content:
              "Hello ser! Your granted roles are attached. They are sent as a file instead of a message because you have so many roles that they can't fit into a single message, congrats! Updating them now.",
            files: [
              new MessageAttachment(Buffer.from(message), `your-roles.txt`),
            ],
          });
        } else {
          await interaction.editReply({
            content: message,
          });
        }

        // Propogate the role updates
        const { addedRoles, persistedRoles, removedRoles } =
          await propogateRoleUpdates(
            lunarAssistant,
            interaction.user.id,
            guildConfigsSnapshot,
            activeRoles,
            inactiveRoles
          );

        await interaction.followUp({
          content: "Roles update completed successfully!",
        });

        const addedRoleNames = guildRoleDictToGuildRoleNameDict(addedRoles);
        const persistedRoleNames =
          guildRoleDictToGuildRoleNameDict(persistedRoles);
        const removedRoleNames = guildRoleDictToGuildRoleNameDict(removedRoles);

        console.log(`Got all tokens and updated roles for ${walletAddress}:`, {
          addedRoles: addedRoleNames,
          persistedRoles: persistedRoleNames,
          removedRoles: removedRoleNames,
        });
      } else {
        await interaction.editReply({
          content: `You have not been granted any roles.`,
        });
      }
    } catch (e) {
      if (e instanceof UserDocMissingError) {
        await interaction.editReply({
          content:
            "Cannot check for roles because you haven't linked a wallet yet. Please link a wallet with /lunar-link and try again.",
        });
      } else if (e instanceof APICallError) {
        await interaction.editReply({
          content:
            "The bot is having trouble reading the nft listings, please try again later. Roles will be frozen until the bot can read listings again.",
        });
      } else {
        console.error("Unknown error when running /lunar-view-roles:");
        console.error(e);

        await interaction.editReply({
          content: "There was an unknown error while executing this command!",
        });
      }
    } finally {
      // If not ephemeral than wait 10 seconds, then delete the reply
      // if (!privateResponse) {
      //   setInterval(async () => {
      //     // Sometimes the message will be gone but we don't want to throw an error when that happens
      //     try {
      //       await interaction.deleteReply();
      //     } catch {}
      //   }, 10 * 1000);
      // }
    }
  },
};

export default lunarVerify;
